"""Expected negative observations are distinct from operational failures."""
class NotReady(Exception):
    """A documented observable condition has not been met yet."""


def require(condition, message):
    if not condition:
        raise NotReady(message)
