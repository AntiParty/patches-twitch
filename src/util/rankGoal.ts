/**
 * Rank goal logic shared by !goal, !rank, the dashboard and the goal overlay.
 *
 * A goal is one of:
 *   - league: reach a league (Gold 2, Diamond 1, Ruby...). Fixed RS thresholds,
 *             except Ruby which tracks the live rank-500 cutoff.
 *   - rs:     reach a raw RS number.
 *   - rank:   reach a leaderboard position (#100). Tracks the RS currently held
 *             at that position, so the target moves with the leaderboard.
 */

export type GoalType = 'league' | 'rs' | 'rank';

export const RUBY_CUTOFF_RANK = 500;
const TIER_SIZE = 2500;
const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

/** League floors: Bronze 4 = 0 RS, each division +2,500, Diamond 1 = 47,500. */
export const LEAGUE_THRESHOLDS: { label: string; rs: number }[] = TIER_NAMES.flatMap((tier, t) =>
    [4, 3, 2, 1].map((div, d) => ({ label: `${tier} ${div}`, rs: (t * 4 + d) * TIER_SIZE }))
);

/** Dashboard tier ids (1=Bronze ... 6=Ruby) → league label at the tier's floor. */
export const DASHBOARD_TIER_LABELS: Record<number, string> = {
    1: 'Bronze 4',
    2: 'Silver 4',
    3: 'Gold 4',
    4: 'Platinum 4',
    5: 'Diamond 4',
    6: 'Ruby',
};

export interface StoredGoal {
    goal_type?: string | null;
    target_label?: string | null;
    target_rank: number;
    target_rank_score?: number | null;
    starting_rank?: number | null;
    starting_rank_score?: number | null;
}

export interface ParsedGoal {
    type: GoalType;
    label: string;
    rank?: number;
    rs?: number;
}

export interface LeaderboardPlayer {
    name: string;
    rank: number;
    league: string;
    rankScore: number;
}

export interface ResolvedTarget {
    type: GoalType;
    label: string;
    targetRS: number | null;
    targetRank: number | null;
}

export interface LastGame {
    change: number | null;
    at: Date | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function titleCase(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Parses `!goal` arguments. Returns null when the input isn't a goal.
 *   ruby | diamond | diamond 1 | plat 2  → league
 *   50000rs | 50k | rs 50000             → rs
 *   #100 | 100                           → leaderboard rank (1–10000)
 */
export function parseGoalInput(args: string[]): ParsedGoal | null {
    const raw = args.join(' ').trim().toLowerCase().replace(/,/g, '');
    if (!raw) return null;

    if (raw === 'ruby' || raw === 'top 500' || raw === 'top500') {
        return { type: 'league', label: 'Ruby' };
    }

    const league = raw.match(/^(bronze|silver|gold|plat|platinum|dia|diamond)\s*([1-4])?$/);
    if (league) {
        const tier = league[1].startsWith('plat') ? 'platinum' : league[1].startsWith('dia') ? 'diamond' : league[1];
        // A bare tier means its entry division (Diamond → Diamond 4).
        const label = `${titleCase(tier)} ${league[2] ?? '4'}`;
        return { type: 'league', label };
    }

    const rs = raw.match(/^(?:rs\s*)?(\d+(?:\.\d+)?)(k)?\s*(?:rs)?$/);
    const hasRsMarker = /rs|k/.test(raw);
    if (rs && hasRsMarker) {
        const value = Math.round(parseFloat(rs[1]) * (rs[2] ? 1000 : 1));
        if (value > 0 && value <= 200000) return { type: 'rs', label: `${fmt(value)} RS`, rs: value };
        return null;
    }

    const rank = raw.match(/^#?(\d+)$/);
    if (rank) {
        const value = parseInt(rank[1], 10);
        if (value >= 1 && value <= 10000) return { type: 'rank', label: `#${value}`, rank: value };
        // The leaderboard only has 10k entries, so anything larger must be RS.
        if (value > 10000 && value <= 200000) return { type: 'rs', label: `${fmt(value)} RS`, rs: value };
    }

    return null;
}

/** Fills in type/label for rows written before goal_type existed. */
export function normalizeStoredGoal(goal: StoredGoal): ParsedGoal {
    const type = goal.goal_type as GoalType | undefined;
    if (type === 'league' && goal.target_label) return { type, label: goal.target_label };
    if (type === 'rs' && goal.target_rank_score) {
        return { type, label: goal.target_label || `${fmt(goal.target_rank_score)} RS`, rs: goal.target_rank_score };
    }
    if (type === 'rank') return { type, label: `#${goal.target_rank}`, rank: goal.target_rank };

    // Legacy: the dashboard stored tier ids 1–6 with no starting rank; chat stored leaderboard ranks.
    if (goal.starting_rank == null && goal.target_rank >= 1 && goal.target_rank <= 6) {
        return { type: 'league', label: DASHBOARD_TIER_LABELS[goal.target_rank] };
    }
    return { type: 'rank', label: `#${goal.target_rank}`, rank: goal.target_rank };
}

/** Works out the RS the goal currently requires, using the live leaderboard where needed. */
export function resolveGoalTarget(goal: ParsedGoal, leaderboard: LeaderboardPlayer[] | null): ResolvedTarget {
    if (goal.type === 'rs') {
        return { type: 'rs', label: goal.label, targetRS: goal.rs ?? null, targetRank: null };
    }
    if (goal.type === 'rank') {
        const holder = leaderboard?.find((p) => p.rank === goal.rank);
        return { type: 'rank', label: goal.label, targetRS: holder?.rankScore ?? null, targetRank: goal.rank ?? null };
    }
    if (goal.label === 'Ruby') {
        const cutoff = leaderboard?.find((p) => p.rank === RUBY_CUTOFF_RANK);
        return { type: 'league', label: 'Ruby', targetRS: cutoff?.rankScore ?? null, targetRank: RUBY_CUTOFF_RANK };
    }
    const threshold = LEAGUE_THRESHOLDS.find((l) => l.label.toLowerCase() === goal.label.toLowerCase());
    return { type: 'league', label: goal.label, targetRS: threshold?.rs ?? null, targetRank: null };
}

export function isGoalAchieved(target: ResolvedTarget, player: LeaderboardPlayer): boolean {
    if (target.targetRank != null) return player.rank > 0 && player.rank <= target.targetRank;
    return target.targetRS != null && player.rankScore >= target.targetRS;
}

export interface GoalProgress {
    target: ResolvedTarget;
    achieved: boolean;
    rsAway: number | null;
    ranksAway: number | null;
    progress: number | null;
    startRS: number | null;
}

export function computeGoalProgress(
    goal: ParsedGoal,
    startRS: number | null | undefined,
    player: LeaderboardPlayer,
    leaderboard: LeaderboardPlayer[] | null
): GoalProgress {
    const target = resolveGoalTarget(goal, leaderboard);
    const achieved = isGoalAchieved(target, player);

    let rsAway: number | null = null;
    if (target.targetRS != null) {
        // Passing a leaderboard position means beating whoever holds it.
        const needed = target.targetRank != null ? target.targetRS + 1 : target.targetRS;
        rsAway = achieved ? 0 : Math.max(0, needed - player.rankScore);
    }

    const ranksAway = target.targetRank != null && !achieved ? Math.max(0, player.rank - target.targetRank) : null;

    let progress: number | null = null;
    if (achieved) {
        progress = 100;
    } else if (target.targetRS != null && startRS != null && target.targetRS > startRS) {
        const pct = ((player.rankScore - startRS) / (target.targetRS - startRS)) * 100;
        progress = Math.max(0, Math.min(99, Math.floor(pct)));
    }

    return { target, achieved, rsAway, ranksAway, progress, startRS: startRS ?? null };
}

/** Placeholder values for custom !goal responses. All values are display strings. */
export function buildGoalVars(input: {
    username: string;
    channel: string;
    player: LeaderboardPlayer;
    progress: GoalProgress | null;
    lastGame: LastGame;
    sessionChange: number | null;
}): Record<string, string> {
    const { player, progress, lastGame } = input;
    const change = lastGame.change;
    const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

    return {
        username: input.username,
        channel: input.channel,
        player: player.name,
        rs: fmt(player.rankScore),
        rankScore: fmt(player.rankScore),
        score: fmt(player.rankScore),
        league: player.league,
        rank: String(player.rank),
        lastChange: change == null ? '0' : signed(change),
        lastChangeAbs: change == null ? '0' : fmt(Math.abs(change)),
        gainedLost: change == null || change === 0 ? 'Gained' : change > 0 ? 'Gained' : 'Lost',
        session: input.sessionChange == null ? '0' : signed(input.sessionChange),
        goal: progress?.target.label ?? '',
        goalRS: progress?.target.targetRS != null ? fmt(progress.target.targetRS) : '',
        rsAway: progress?.rsAway != null ? fmt(progress.rsAway) : '',
        ranksAway: progress?.ranksAway != null ? fmt(progress.ranksAway) : '',
        progress: progress?.progress != null ? `${progress.progress}%` : '',
        startRS: progress?.startRS != null ? fmt(progress.startRS) : '',
    };
}

export function applyTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

/** Built-in !goal reply, used when the channel has no custom response. */
export function formatDefaultGoalMessage(vars: Record<string, string>, progress: GoalProgress | null, lastGame: LastGame): string {
    const parts = [`${vars.channel} is at ${vars.rs} RS in ${vars.league} (#${vars.rank})`];

    if (lastGame.change != null && lastGame.change !== 0) {
        parts.push(`${lastGame.change > 0 ? 'Gained' : 'Lost'} ${vars.lastChangeAbs} RS last game`);
    }

    if (progress) {
        if (progress.achieved) {
            parts.push(`Goal reached: ${vars.goal}`);
        } else if (progress.rsAway != null) {
            let goalPart = `${vars.rsAway} RS away from ${vars.goal}`;
            if (progress.progress != null) goalPart += ` (${vars.progress} there)`;
            parts.push(goalPart);
        } else {
            parts.push(`Goal: ${vars.goal}`);
        }
    }

    return parts.join('. ') + '.';
}
