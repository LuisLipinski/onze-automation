package com.onze.automation;

import com.onze.api.OnzeApiApplication;
import com.onze.api.auth.PasswordResetEmailSender;
import com.onze.api.auth.SessionClock;
import com.onze.api.user.UserRepository;
import com.onze.api.group.GroupPhotoStorage;
import com.onze.api.group.GroupDeletionNotificationProcessor;
import com.onze.api.match.MatchTeamImageStorage;
import com.onze.api.match.MatchLifecycleService;
import com.onze.api.match.MatchNotificationProcessor;
import com.onze.api.match.LiveMatchService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import tools.jackson.databind.json.JsonMapper;

/** Test process only. This class is never packaged in onze-api or deployed. */
public class AutomationApplication {
    static final AtomicReference<Instant> NOW = new AtomicReference<>(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    static final AtomicReference<Instant> SESSION_NOW = new AtomicReference<>(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    static final List<Map<String, String>> EMAILS = new CopyOnWriteArrayList<>();
    static final List<Object> PUSHES = new CopyOnWriteArrayList<>();
    static final Map<String, byte[]> MEDIA = new ConcurrentHashMap<>();
    static final Queue<Map<String, Object>> EXPO_REPLIES = new ConcurrentLinkedQueue<>();
    static final AtomicReference<Map<String, Object>> EXPO_DEFAULT_REPLY = new AtomicReference<>();
    static volatile boolean failMedia;
    static volatile boolean failEmail;
    static volatile boolean failRefresh;

    public static void main(String[] args) throws Exception {
        String jdbc = System.getenv("DATABASE_URL");
        String token = System.getenv("AUTOMATION_CONTROL_TOKEN");
        if (!"1".equals(System.getenv("ONZE_AUTOMATION_RUNTIME"))
                || jdbc == null || !jdbc.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/onze_automation[a-z_]*")
                || token == null || token.length() < 24) {
            throw new IllegalStateException("Automation requires an isolated loopback onze_automation database and control token");
        }
        ConfigurableApplicationContext app = SpringApplication.run(
                new Class<?>[]{OnzeApiApplication.class, Boundaries.class}, args);
        JsonMapper json = app.getBean(JsonMapper.class);
        JdbcTemplate db = app.getBean(JdbcTemplate.class);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1",
                Integer.parseInt(System.getenv("AUTOMATION_CONTROL_PORT"))), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath();
                if (path.startsWith("/media/") && exchange.getRequestMethod().equals("GET")) {
                    byte[] content = MEDIA.get(path.substring("/media".length()));
                    if (content == null) { respond(exchange, json, 404, Map.of("error", "media not found")); return; }
                    exchange.getResponseHeaders().set("Content-Type", content[0] == (byte) 0xFF ? "image/jpeg" : "image/png");
                    exchange.sendResponseHeaders(200, content.length);
                    exchange.getResponseBody().write(content);
                    exchange.close();
                    return;
                }
                if (path.equals("/expo")) {
                    Object payload = json.readValue(exchange.getRequestBody().readAllBytes(), Object.class);
                    PUSHES.add(payload);
                    Map<String, Object> reply = EXPO_REPLIES.poll();
                    if (reply == null) reply = EXPO_DEFAULT_REPLY.get();
                    int status = reply == null ? 200 : ((Number) reply.getOrDefault("status", 200)).intValue();
                    Object body = reply == null ? Map.of("data", List.of(Map.of("status", "ok", "id", UUID.randomUUID().toString())))
                            : reply.getOrDefault("body", Map.of("data", List.of(Map.of("status", "ok"))));
                    respond(exchange, json, status, body);
                    return;
                }
                if (!token.equals(exchange.getRequestHeaders().getFirst("X-Automation-Token"))) {
                    respond(exchange, json, 403, Map.of("error", "control token required"));
                    return;
                }
                byte[] rawBody = exchange.getRequestBody().readAllBytes();
                Map<String, Object> body = rawBody.length == 0 ? Map.of() : json.readValue(rawBody, Map.class);
                Object result;
                switch (path) {
                    case "/reset" -> {
                        List<String> tables = db.queryForList("select tablename from pg_tables where schemaname='public' and tablename <> 'flyway_schema_history' order by tablename", String.class);
                        if (!tables.isEmpty()) truncateWithRetry(db, "truncate table " + tables.stream().map(n -> "\"" + n.replace("\"", "\"\"") + "\"").collect(java.util.stream.Collectors.joining(",")) + " restart identity cascade");
                        NOW.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)); EMAILS.clear(); PUSHES.clear(); MEDIA.clear(); EXPO_REPLIES.clear(); EXPO_DEFAULT_REPLY.set(null);
                        SESSION_NOW.set(NOW.get());
                        failMedia = false; failEmail = false; failRefresh = false;
                        result = Map.of("now", NOW.get().toString());
                    }
                    case "/clock" -> {
                        if (body.containsKey("instant")) NOW.set(Instant.parse(body.get("instant").toString()));
                        result = Map.of("now", NOW.get().toString());
                    }
                    case "/auth-clock" -> {
                        if (body.containsKey("instant")) SESSION_NOW.set(Instant.parse(body.get("instant").toString()));
                        result = Map.of("now", SESSION_NOW.get().toString());
                    }
                    case "/session-stats" -> result = db.queryForMap("select count(*)::int as total, "
                            + "count(*) filter (where consumed_at is not null)::int as consumed, "
                            + "count(*) filter (where revoked_at is not null)::int as revoked from auth_refresh_tokens");
                    case "/legacy-access" -> {
                        var user = app.getBean(UserRepository.class).findById(UUID.fromString(body.get("userId").toString())).orElseThrow();
                        var claims = JwtClaimsSet.builder().issuer(app.getEnvironment().getRequiredProperty("security.jwt.issuer"))
                                .subject(user.getId().toString()).issuedAt(SESSION_NOW.get().minusSeconds(1))
                                .expiresAt(SESSION_NOW.get().plus(Duration.ofHours(2)))
                                .claim("email", user.getEmail()).claim("name", user.getDisplayName()).build();
                        result = Map.of("accessToken", app.getBean(JwtEncoder.class).encode(JwtEncoderParameters.from(claims)).getTokenValue());
                    }
                    case "/emails" -> result = List.copyOf(EMAILS);
                    case "/pushes" -> result = List.copyOf(PUSHES);
                    case "/media" -> result = MEDIA.entrySet().stream().map(entry -> {
                        try {
                            var image = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(entry.getValue()));
                            return Map.of("path", entry.getKey(), "bytes", entry.getValue().length,
                                    "width", image == null ? 0 : image.getWidth(), "height", image == null ? 0 : image.getHeight());
                        } catch (java.io.IOException exception) { throw new IllegalStateException(exception); }
                    }).toList();
                    case "/expo-plan" -> { EXPO_REPLIES.add(body); result = Map.of("queued", true); }
                    case "/expo-default" -> { EXPO_DEFAULT_REPLY.set(body); result = Map.of("configured", true); }
                    case "/boundaries" -> {
                        failMedia = Boolean.TRUE.equals(body.get("failMedia"));
                        failEmail = Boolean.TRUE.equals(body.get("failEmail"));
                        failRefresh = Boolean.TRUE.equals(body.get("failRefresh"));
                        result = Map.of("configured", true);
                    }
                    case "/expire-reset-code" -> {
                        UUID userId = UUID.fromString(body.get("userId").toString());
                        int changed = db.update("update password_reset_codes set expires_at = now() - interval '1 minute' where user_id = ?", userId);
                        result = Map.of("changed", changed);
                    }
                    case "/allow-reset-resend" -> {
                        UUID userId = UUID.fromString(body.get("userId").toString());
                        int changed = db.update("update password_reset_codes set created_at = now() - interval '2 minutes' where user_id = ?", userId);
                        result = Map.of("changed", changed);
                    }
                    case "/unlock-login" -> {
                        UUID userId = UUID.fromString(body.get("userId").toString());
                        int changed = db.update("update users set login_blocked_until = ? where id = ?",
                                java.sql.Timestamp.from(NOW.get().minusSeconds(1)), userId);
                        result = Map.of("changed", changed);
                    }
                    case "/process" -> {
                        int opened = app.getBean(MatchLifecycleService.class).openDueAttendances();
                        app.getBean(MatchLifecycleService.class).scheduleDueAttendanceReminders();
                        app.getBean(LiveMatchService.class).finishExpiredMatches();
                        int notifications = app.getBean(MatchNotificationProcessor.class).processPending();
                        int deleted = app.getBean(GroupDeletionNotificationProcessor.class).processPending();
                        result = Map.of("opened", opened, "notifications", notifications, "deletions", deleted);
                    }
                    case "/outbox" -> result = db.queryForList("select id::text, notification_type, status, attempts, recipient_user_id::text, match_id::text, last_error from match_notification_jobs order by created_at");
                    case "/devices" -> result = db.queryForList("select user_id::text, expo_push_token, active from push_devices");
                    case "/routes" -> result = app.getBean("requestMappingHandlerMapping",
                            org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping.class)
                            .getHandlerMethods().entrySet().stream()
                            .filter(entry -> entry.getValue().getBeanType().getPackageName().startsWith("com.onze.api"))
                            .flatMap(entry -> entry.getKey().getMethodsCondition().getMethods().stream()
                                    .flatMap(method -> entry.getKey().getPatternValues().stream().map(pattern -> method.name() + " " + pattern)))
                            .sorted().toList();
                    default -> { respond(exchange, json, 404, Map.of("error", "unknown control operation")); return; }
                }
                respond(exchange, json, 200, result);
            } catch (Throwable error) {
                respond(exchange, json, 500, Map.of("error", error.getClass().getSimpleName(), "message", String.valueOf(error.getMessage())));
            } finally { exchange.close(); }
        });
        server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.stop(0); app.close(); }));
        System.out.println("AUTOMATION_CONTROL_READY");
    }

    static void truncateWithRetry(JdbcTemplate db, String sql) {
        // TRUNCATE is one atomic, autocommit statement. A deadlock rolls it
        // back completely; an async refresh from the previous case can finish
        // before the next attempt. Persistent and unrelated errors still fail.
        for (int attempt = 0; ; attempt++) {
            try { db.execute(sql); return; }
            catch (DataAccessException failure) {
                boolean deadlock = false;
                for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
                    if (cause instanceof SQLException error && "40P01".equals(error.getSQLState())) deadlock = true;
                }
                if (!deadlock || attempt >= 2) throw failure;
                System.err.println("Automation reset deadlock; retry " + (attempt + 1) + "/2");
                try { Thread.sleep(50L * (attempt + 1)); }
                catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Automation reset interrupted", interrupted);
                }
            }
        }
    }

    static void respond(HttpExchange exchange, JsonMapper json, int status, Object value) throws java.io.IOException {
        byte[] bytes = json.writeValueAsBytes(value);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Configuration(proxyBeanMethods = false)
    static class Boundaries {
        @Bean @Primary SessionClock automationSessionClock() { return SESSION_NOW::get; }
        @Bean jakarta.servlet.Filter refreshFailureBoundary() {
            return (request, response, chain) -> {
                if (failRefresh && request instanceof jakarta.servlet.http.HttpServletRequest http
                        && http.getRequestURI().equals("/api/auth/refresh")) {
                    var reply = (jakarta.servlet.http.HttpServletResponse) response;
                    reply.setStatus(503);
                    reply.setContentType("application/json;charset=UTF-8");
                    reply.getWriter().write("{\"code\":\"TEMPORARY_SESSION_FAILURE\",\"message\":\"Não foi possível renovar seu acesso agora. Tente novamente.\"}");
                } else chain.doFilter(request, response);
            };
        }
        @Bean @Primary Clock automationClock() {
            return new Clock() {
                public ZoneId getZone() { return ZoneOffset.UTC; }
                public Clock withZone(ZoneId zone) { return this; }
                public Instant instant() { return NOW.get(); }
            };
        }
        @Bean @Primary PasswordResetEmailSender capturedEmails() {
            return (email, code) -> {
                if (failEmail) throw new IllegalStateException("simulated email provider failure");
                EMAILS.add(Map.of("email", email, "code", code));
            };
        }
        @Bean @Primary GroupPhotoStorage capturedGroupPhotos() {
            return (groupId, bytes) -> {
                if (failMedia) throw new com.onze.api.group.GroupService.PhotoUploadFailedException();
                if (bytes.length == 0) throw new IllegalArgumentException("empty media");
                String path = "/groups/" + groupId + ".png";
                MEDIA.put(path, bytes.clone());
                return System.getenv().getOrDefault("AUTOMATION_MEDIA_BASE_URL", "https://media.onze.test") + path;
            };
        }
        @Bean @Primary MatchTeamImageStorage capturedTeamPhotos() {
            return (groupId, type, side, bytes) -> {
                if (failMedia) throw new IllegalStateException("simulated media provider failure");
                String path = "/teams/" + groupId + "/" + type + "/" + side + ".png";
                MEDIA.put(path, bytes.clone());
                return System.getenv().getOrDefault("AUTOMATION_MEDIA_BASE_URL", "https://media.onze.test") + path;
            };
        }
    }
}
