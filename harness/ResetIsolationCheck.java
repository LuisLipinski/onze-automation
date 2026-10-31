package com.onze.automation;

import java.sql.SQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Real PostgreSQL regression checks, confined to a disposable probe schema. */
public class ResetIsolationCheck {
    public static void main(String[] args) {
        String port = System.getenv().getOrDefault("AUTOMATION_POSTGRES_PORT", "5432");
        if (!port.matches("[0-9]+")) throw new IllegalArgumentException("Invalid local database port");
        var db = new JdbcTemplate(new DriverManagerDataSource(
                "jdbc:postgresql://127.0.0.1:" + port + "/onze_automation",
                System.getenv().getOrDefault("AUTOMATION_DATABASE_USER", "onze"),
                System.getenv().getOrDefault("AUTOMATION_DATABASE_PASSWORD", "onze-automation-only")));
        String schema = "reset_probe_" + Long.toUnsignedString(System.nanoTime());
        String rows = schema + ".probe_rows";
        String sequence = schema + ".attempts";
        db.execute("create schema " + schema);
        try {
            db.execute("create table " + rows + " (id integer)");
            db.execute("create sequence " + sequence);
            for (String scenario : new String[]{"transient", "persistent", "unrelated"}) {
                db.execute("truncate " + rows);
                db.update("insert into " + rows + " values (1)");
                db.execute("alter sequence " + sequence + " restart with 1");
                String condition = scenario.equals("transient") ? "attempt = 1" : "true";
                String state = scenario.equals("unrelated") ? "23514" : "40P01";
                String sql = "do $$ declare attempt bigint; begin "
                        + "attempt := nextval('" + sequence + "'); delete from " + rows + "; "
                        + "if " + condition + " then raise exception 'reset probe' using errcode='" + state + "'; end if; "
                        + "truncate " + rows + "; end $$";
                boolean failed = false;
                String observedState = null;
                try { AutomationApplication.truncateWithRetry(db, sql); }
                catch (DataAccessException expected) {
                    failed = true;
                    for (Throwable cause = expected; cause != null; cause = cause.getCause()) {
                        if (cause instanceof SQLException error) observedState = error.getSQLState();
                    }
                }
                int attempts = db.queryForObject("select last_value from " + sequence, Integer.class);
                int remaining = db.queryForObject("select count(*) from " + rows, Integer.class);
                if (scenario.equals("transient")) {
                    check(!failed && attempts == 2 && remaining == 0, "Transient deadlock must recover atomically");
                } else if (scenario.equals("persistent")) {
                    check(failed && state.equals(observedState) && attempts == 3 && remaining == 1, "Persistent deadlock must fail with data rolled back");
                } else {
                    check(failed && state.equals(observedState) && attempts == 1 && remaining == 1, "Unrelated errors must fail immediately with data rolled back");
                }
            }
            System.out.println("3 reset isolation checks passed (PostgreSQL SQLSTATE and rollback)");
        } finally { db.execute("drop schema " + schema + " cascade"); }
    }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
