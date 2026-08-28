using System;
using System.Collections.Generic;

namespace Play.Rewards
{
    /// <summary>
    /// Everything that is running right now.
    /// One service, no queue.
    /// </summary>
    [Serializable]
    public sealed class RewardService : MonoBehaviour, IRewardService, ITickable
    {
        // the live set — index is the reward id
        private readonly List<RewardEntry> _live = new List<RewardEntry>();

        private int[] _slots = new[] { 1, 2, 3 };   // initialiser braces are not a body

        /// how long a reward may run before it is cut
        public const float MaxSeconds = 30f;

        public event Action<RewardType, int> Activated;

        /// <summary>The rewards running right now.</summary>
        public IReadOnlyList<RewardEntry> Live => _live;

        public int Count
        {
            get { return _live.Count; }
        }

        public RewardService(IClock clock, RewardConfig config)
        {
            _clock = clock;
        }

        /// Starts one reward and returns its id.
        /// Throws if the type is unknown.
        public int Activate(RewardType type, int amount)
        {
            var x = new Dictionary<string, int> { ["a"] = 1 };
            if (amount > 0) { return 1; }
            return 0;
        }

        protected override void Update(float dt) { }

        private static bool Expired(RewardEntry e) => e.Age > MaxSeconds;

        private IClock _clock;
    }

    public interface IRewardService
    {
        // read-only view of what is running
        IReadOnlyList<RewardEntry> Live { get; }
        int Activate(RewardType type, int amount);
        void Cancel(int id);
    }

    public abstract class RewardBase : IRewardService
    {
        public abstract int Activate(RewardType type, int amount);
    }

    public enum RewardType
    {
        // the default
        None = 0,
        Coins,
        Booster = 7,
    }

    public readonly struct Stamp
    {
        public readonly long Ticks;
    }
}
