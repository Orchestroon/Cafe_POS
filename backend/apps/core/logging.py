import json
import logging


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Never pass request bodies, cookies or tokens to loggers."""

    def format(self, record):
        out = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out)
