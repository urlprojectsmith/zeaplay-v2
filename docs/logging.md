# Logging

Zea Play uses Pino-compatible structured logging. Correlation IDs are established at the HTTP boundary and must be propagated through logs, future queue jobs, and future webhook execution.

Log fields should include service name, environment, request ID, correlation ID, status, duration, and dependency names where relevant.
