/**
 * naamah — the design vocabulary.
 *
 * A design is a directory of ordinary TypeScript files. Types are plain classes, interfaces and
 * enums; the relations between them are decorators. Nothing here has a runtime — every declaration
 * is ambient. Their whole job is to be TYPECHECKED, so that `tsc --noEmit` refuses a design naming a
 * type which does not exist.
 *
 * That refusal is the point. An architecture contract whose edges can dangle is not a contract.
 *
 *   @Domain('Rewards')
 *   @Owns<RewardEntry>()
 *   @Uses<IConfig>()
 *   declare class RewardService implements IRewardService {
 *       private ledger: Ledger;        // a bare field implies an edge too
 *       /** Grants a reward. MUST be idempotent — a repeated playerId is a no-op. *\/
 *       grant(playerId: string): void; // no body: that is what `declare` is for
 *   }
 *
 *   @UsedBy<RewardService>()           // the SAME edge, declared from the far end
 *   declare class Ledger {}
 *
 * ── TWO RULES, AND THEY ARE THE WHOLE FORMAT ────────────────────────────────────────────────────
 *
 * 1. NO `import` AND NO `export`, EVER. A file containing either becomes a *module*, and a module
 *    has its own scope — so `Ledger` in one file stops being visible from another and every
 *    relation across files fails with "Cannot find name". Without them, every design file is a
 *    *script* sharing ONE global scope: any type can name any other, from anywhere, with nothing to
 *    wire up. This vocabulary file is ambient for the same reason, which is why it has no `export`
 *    either.
 *
 * 2. NAME THE TARGET IN THE TYPE POSITION — `@Owns<Entry>()`, not `@Owns(Entry)`. Types are hoisted
 *    and values are not, so the value form breaks the moment a relation points at a class declared
 *    further down the file (TS2449), and cannot name an interface at all, because interfaces are
 *    erased and have no value. The type form has neither limit. The value form is still accepted
 *    where it happens to work, but the type form always works.
 *
 * ── DECLARE FROM WHICHEVER END YOU ARE LOOKING AT ───────────────────────────────────────────────
 *
 * `@Owns<B>()` on A and `@OwnedBy<A>()` on B are ONE edge, not two. Write the fact where it belongs
 * and never hunt for "the file that owns this arrow"; saying it from both ends is agreement, and
 * draws once.
 *
 * ── TWO LIMITS WORTH KNOWING ────────────────────────────────────────────────────────────────────
 *
 * `declare class`, NOT `class`. A member with no body is only legal in an ambient declaration; a
 * plain `class` with a bodyless method is TS2391 ("Function implementation is missing"), whose text
 * says nothing about the actual rule. A sketch declares a shape and implements nothing, which is
 * precisely what `declare` means.
 *
 * TypeScript forbids a decorator on an `interface` (TS1206). A plain undecorated `interface` is fine
 * and is read normally. When an interface needs a domain or a relation of its own, use a declared
 * class and say what it is:
 *
 *   @Domain('Rewards')
 *   @Kind('interface')
 *   declare class IRewardService { grant(playerId: string): void; }
 *
 * A TYPE MAY NOT BE NAMED AFTER THIS VOCABULARY. The names below live in the design's own global
 * scope, so `class Domain` or `class Owns` collides with the decorator of that name and the compiler
 * reports it against THIS file rather than against the sketch. `Note` was renamed `Remark` for
 * exactly that reason — a design having a type called Note is likely enough that reserving the word
 * would be refusing the design instead of protecting it.
 */

/* ── structure ─────────────────────────────────────────────────────── */

/** Which domain (assembly / package / module) owns this type. Nest with `›`: `'Rewards › Streak'`. */
declare function Domain(name: string): ClassDecorator;

/** The «guillemet» label on the card. */
declare function Stereotype(text: string): ClassDecorator;

/** A remark tethered to this type — prose about the type that is not a member. */
declare function Remark(text: string): ClassDecorator;

/**
 * Override the card's kind. TypeScript has no value types, so a design meaning `struct` says so
 * here; and it is how an `abstract class` standing in for an interface is drawn as one.
 */
declare function Kind(kind: 'class' | 'interface' | 'abstract' | 'enum' | 'struct'): ClassDecorator;

/* ── relations, declared from the SUBJECT ──────────────────────────── */

/** Composition — this type owns T's lifetime. A filled diamond. */
declare function Owns<T = never>(t?: unknown): ClassDecorator;

/** Aggregation — this type holds a T it did not create. A hollow diamond. */
declare function Has<T = never>(t?: unknown): ClassDecorator;

/** Dependency — this type calls T but does not hold one. A dashed arrow. */
declare function Uses<T = never>(t?: unknown): ClassDecorator;

/** Association — this type refers to T. A plain line. */
declare function Refers<T = never>(t?: unknown): ClassDecorator;

/** Generalisation. Usually the `extends` keyword says this already; here for when it cannot. */
declare function Extends<T = never>(t?: unknown): ClassDecorator;

/** Realisation. Usually the `implements` keyword says this already. */
declare function Implements<T = never>(t?: unknown): ClassDecorator;

/* ── the same relations, declared from the OBJECT ───────────────────── */
/* Each means exactly what its mirror above means, with the direction flipped. */

/** T owns this. Mirror of `@Owns`. */
declare function OwnedBy<T = never>(t?: unknown): ClassDecorator;

/** T holds this. Mirror of `@Has`. */
declare function HeldBy<T = never>(t?: unknown): ClassDecorator;

/** T uses this. Mirror of `@Uses`. */
declare function UsedBy<T = never>(t?: unknown): ClassDecorator;

/** T refers to this. Mirror of `@Refers`. */
declare function ReferredBy<T = never>(t?: unknown): ClassDecorator;

/** T extends this — i.e. this is the base. Mirror of `@Extends`. */
declare function ExtendedBy<T = never>(t?: unknown): ClassDecorator;

/** T implements this — i.e. this is the interface. Mirror of `@Implements`. */
declare function ImplementedBy<T = never>(t?: unknown): ClassDecorator;

/* ── members ───────────────────────────────────────────────────────── */

/**
 * What a member MUST DO — the half a signature cannot carry.
 *
 * A name and a type say a multiplier is a number. They cannot say it is the maximum of the live
 * values rather than their product, and that is exactly what an implementer needs. A doc comment
 * above the member does the same job and reads better; this exists for when the intent should be
 * machine-readable rather than prose.
 */
declare function Must(intent: string): MethodDecorator & PropertyDecorator;
