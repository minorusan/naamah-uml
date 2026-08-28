// A diagram authored from source files — what `naamah author` takes.
//
// Every class here is bound to a real file: naamah reads its name, kind, fields, properties and
// methods, and keeps the comments above each member as that row's folded-away explanation. Rows
// added by hand below a binding survive every later `naamah sync`.

export default ({ create }) => {
  const loom = create('Rewards — bound to source');

  const runtime = loom.domain('Rewards › runtime');
  const api = runtime.type('IRewardService', { fromFile: 'RewardService.cs', symbol: 'IRewardService' });
  const svc = runtime.type('RewardService', { fromFile: 'RewardService.cs' });
  const kind = runtime.type('RewardType', { fromFile: 'RewardService.cs', symbol: 'RewardType' });

  const server = loom.domain('Server › node');
  const store = server.type('SessionStore', { fromFile: 'session-store.ts' });

  const py = loom.domain('Tools › python');
  const pysvc = py.type('RewardService', { fromFile: 'reward_service.py' });

  svc.implements(api);
  svc.uses(kind);
  svc.has(store);
  pysvc.refers(svc);

  // A hand-written row on a bound card: not in the file, and not lost when the file changes.
  svc.lede('bound to Runtime/RewardService.cs', { explain: 'naamah sync re-reads it' });

  svc.note('Parallel by default.', ['No queue, no policy.']);

  return loom;
};
