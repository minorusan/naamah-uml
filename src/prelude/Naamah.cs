/*
 * naamah — the design vocabulary, C# edition.
 *
 * A design is a directory of ordinary C# files. Types are plain classes, interfaces, structs and
 * enums; the relations between them are attributes. Nothing here has behaviour — every attribute is
 * an empty marker. Their whole job is to be COMPILED, so that a design naming a type which does not
 * exist is refused (CS0246) instead of quietly losing an arrow.
 *
 *   [Domain("Rewards")]
 *   [Owns(typeof(RewardEntry))]
 *   [Uses(typeof(IConfig))]
 *   public class RewardService : IRewardService {
 *       private Ledger _ledger;                    // a bare field implies an edge too
 *       public void Grant(string playerId) { }     // what it must DO goes in the comment above it
 *   }
 *
 *   [UsedBy(typeof(RewardService))]                // the SAME edge, declared from the far end
 *   public class Ledger { }
 *
 * ── TWO RULES ───────────────────────────────────────────────────────────────────────────────────
 *
 * 1. NO `namespace`, AND NO `using` BEYOND THIS FILE. Every design file compiles into ONE global
 *    namespace, which is what lets any type name any other with nothing to wire up. A `namespace`
 *    block puts a type somewhere the rest of the design cannot see by bare name.
 *
 * 2. NAME THE TARGET WITH `typeof(...)`. Unlike TypeScript, C# keeps interfaces at runtime, so
 *    `typeof(IConfig)` is legal and is the ONLY form needed here — there is no generic-attribute
 *    spelling to reach for, and mono's compiler predates generic attributes anyway.
 *
 * ── DECLARE FROM WHICHEVER END YOU ARE LOOKING AT ───────────────────────────────────────────────
 *
 * `[Owns(typeof(B))]` on A and `[OwnedBy(typeof(A))]` on B are ONE edge, not two. Write the fact
 * where it belongs; saying it from both ends is agreement, and draws once.
 */

using System;

/* ── structure ─────────────────────────────────────────────────────── */

/// <summary>Which domain (assembly / package) owns this type. Nest with a chevron: "Rewards › Streak".</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = false)]
public sealed class DomainAttribute : Attribute { public DomainAttribute(string name) { } }

/// <summary>The «guillemet» label on the card.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = false)]
public sealed class StereotypeAttribute : Attribute { public StereotypeAttribute(string text) { } }

/// <summary>A remark tethered to this type — prose about it that is not a member.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class RemarkAttribute : Attribute { public RemarkAttribute(string text) { } }

/// <summary>Override the card's kind, when the host language cannot say it.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = false)]
public sealed class KindAttribute : Attribute { public KindAttribute(string kind) { } }

/* ── relations, declared from the SUBJECT ──────────────────────────── */

/// <summary>Composition — this type owns the target's lifetime. A filled diamond.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class OwnsAttribute : Attribute { public OwnsAttribute(Type target) { } }

/// <summary>Aggregation — this type holds a target it did not create. A hollow diamond.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class HasAttribute : Attribute { public HasAttribute(Type target) { } }

/// <summary>Dependency — this type calls the target but does not hold one. A dashed arrow.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class UsesAttribute : Attribute { public UsesAttribute(Type target) { } }

/// <summary>Association — this type refers to the target. A plain line.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class RefersAttribute : Attribute { public RefersAttribute(Type target) { } }

/// <summary>Generalisation. Usually the base list says this already.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ExtendsAttribute : Attribute { public ExtendsAttribute(Type target) { } }

/// <summary>Realisation. Usually the base list says this already.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ImplementsAttribute : Attribute { public ImplementsAttribute(Type target) { } }

/* ── the same relations, declared from the OBJECT ───────────────────── */

/// <summary>The target owns this. Mirror of Owns.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class OwnedByAttribute : Attribute { public OwnedByAttribute(Type target) { } }

/// <summary>The target holds this. Mirror of Has.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class HeldByAttribute : Attribute { public HeldByAttribute(Type target) { } }

/// <summary>The target uses this. Mirror of Uses.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class UsedByAttribute : Attribute { public UsedByAttribute(Type target) { } }

/// <summary>The target refers to this. Mirror of Refers.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ReferredByAttribute : Attribute { public ReferredByAttribute(Type target) { } }

/// <summary>The target extends this — i.e. this is the base. Mirror of Extends.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ExtendedByAttribute : Attribute { public ExtendedByAttribute(Type target) { } }

/// <summary>The target implements this — i.e. this is the interface. Mirror of Implements.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ImplementedByAttribute : Attribute { public ImplementedByAttribute(Type target) { } }

/* ── members ───────────────────────────────────────────────────────── */

/// <summary>
/// What a member MUST DO — the half a signature cannot carry. A doc comment above the member does
/// the same job and reads better; this exists for when the intent should be machine-readable.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Property | AttributeTargets.Field, AllowMultiple = false)]
public sealed class MustAttribute : Attribute { public MustAttribute(string intent) { } }
