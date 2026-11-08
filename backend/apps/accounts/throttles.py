from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class LoginIPThrottle(AnonRateThrottle):
    scope = "login_ip"


class LoginUsernameThrottle(SimpleRateThrottle):
    scope = "login_username"

    def get_cache_key(self, request, view):
        username = request.data.get("username") if isinstance(request.data, dict) else None
        if not isinstance(username, str) or not username:
            return None
        return self.cache_format % {"scope": self.scope, "ident": username.strip().lower()}
