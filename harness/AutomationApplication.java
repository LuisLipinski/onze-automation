package com.onze.automation;

import com.onze.api.OnzeApiApplication;
import com.onze.api.auth.PasswordResetEmailSender;
import com.onze.api.group.GroupPhotoStorage;
import com.onze.api.group.GroupDeletionNotificationProcessor;
import com.onze.api.match.MatchTeamImageStorage;
import com.onze.api.match.MatchLifecycleService;
import com.onze.api.match.MatchNotificationProcessor;
import com.onze.api.match.LiveMatchService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Test process only. This class is never packaged in onze-api or deployed. */
public class AutomationApplication {
    static final AtomicReference<Instant> NOW = new AtomicReference<>(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    static final List<Map<String, String>> EMAILS = new CopyOnWriteArrayList<>();
    static final List<Object> PUSHES = new CopyOnWriteArrayList<>();
    static final Queue<Map<String, Object>> EXPO_REPLIES = new ConcurrentLinkedQueue<>();
    static volatile boolean failMedia;
    static volatile boolean failEmail;

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
                if (path.equals("/expo")) {
                    Object payload = json.readValue(exchange.getRequestBody().readAllBytes(), Object.class);
                    PUSHES.add(payload);
                    Map<String, Object> reply = EXPO_REPLIES.poll();
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
                        List<String> tables = db.queryForList("select tablename from pg_tables where schemaname='public' and tablename <> 'flyway_schema_history'", String.class);
                        if (!tables.isEmpty()) db.execute("truncate table " + tables.stream().map(n -> "\"" + n.replace("\"", "\"\"") + "\"").collect(java.util.stream.Collectors.joining(",")) + " restart identity cascade");
                        NOW.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)); EMAILS.clear(); PUSHES.clear(); EXPO_REPLIES.clear();
                        failMedia = false; failEmail = false;
                        result = Map.of("now", NOW.get().toString());
                    }
                    case "/clock" -> {
                        if (body.containsKey("instant")) NOW.set(Instant.parse(body.get("instant").toString()));
                        result = Map.of("now", NOW.get().toString());
                    }
                    case "/emails" -> result = List.copyOf(EMAILS);
                    case "/pushes" -> result = List.copyOf(PUSHES);
                    case "/expo-plan" -> { EXPO_REPLIES.add(body); result = Map.of("queued", true); }
                    case "/boundaries" -> {
                        failMedia = Boolean.TRUE.equals(body.get("failMedia"));
                        failEmail = Boolean.TRUE.equals(body.get("failEmail"));
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

    static void respond(HttpExchange exchange, JsonMapper json, int status, Object value) throws java.io.IOException {
        byte[] bytes = json.writeValueAsBytes(value);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Configuration(proxyBeanMethods = false)
    static class Boundaries {
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
                return "https://media.onze.test/groups/" + groupId + ".png";
            };
        }
        @Bean @Primary MatchTeamImageStorage capturedTeamPhotos() {
            return (groupId, type, side, bytes) -> {
                if (failMedia) throw new IllegalStateException("simulated media provider failure");
                return "https://media.onze.test/teams/" + groupId + "/" + type + "/" + side + ".png";
            };
        }
    }
}
