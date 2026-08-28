from abc import ABC, abstractmethod
from enum import Enum
from typing import Protocol


class RewardType(Enum):
    """What kind of reward it is."""

    # the default
    NONE = 0
    COINS = 1
    BOOSTER = 7


class Clock(Protocol):
    def now(self) -> float:
        ...


class RewardService(ABC, Clock):
    """
    Everything that is running right now.

    One service, no queue.
    """

    MAX_SECONDS: float = 30.0
    _registry = {}

    def __init__(self, clock: Clock, config: "RewardConfig") -> None:
        # the live set — index is the reward id
        self._live: list = []
        self.clock = clock
        self.__secret = 1

    @property
    def live(self) -> list:
        """The rewards running right now."""
        return self._live

    def activate(
        self,
        kind: RewardType,
        amount: int = 1,
    ) -> int:
        """Starts one reward and returns its id.

        Throws if the type is unknown.
        """
        return 0

    @abstractmethod
    def cancel(self, reward_id: int) -> None:
        ...

    @staticmethod
    def _expired(entry) -> bool:
        return False

    def __repr__(self) -> str:
        return "RewardService()"
