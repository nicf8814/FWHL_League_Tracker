// FWHL dataset, schema v1 (audit DATA-6). Normalized: every entity is a flat list keyed by ids,
// nothing embeds a copy of another entity, and nothing names "you" (DATA-2). The same shape is the
// contract for a future API, so swapping storage never touches the UI.

export const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type Pos = (typeof POSITIONS)[number];
export type TeamId = number; // ESPN league team id (1-12)
export type PlayerId = string; // opaque, stable ("pl-0001"); never derived from a name at runtime (DATA-1)

export interface Source {
  id: 'espn' | 'scores' | 'peaked' | 'menton' | 'fantasypros' | (string & {});
  label: string;
  asOf: string; // ISO date, or "Week N" for weekly charts
  week?: number;
  throughWeek?: number;
}

export interface Meta {
  league: string;
  espnLeagueId: number;
  season: number;
  exportedAt: string;
  sources: Source[];
}

export interface SimConfig {
  weeklySd: number;
  teamSd: number;
  shrink: number;
  avgScore: number;
  runs: number;
  seed: number;
}

export interface Season {
  year: number;
  regularSeasonWeeks: number;
  top6Weeks: number[]; // weeks scored as top 6 = W, bottom 6 = L, not head-to-head
  playoffWeeks: number[];
  tradeDeadline: string;
  lineup: Pos[][]; // each slot lists the positions that can fill it, in fill order
  seedsByRecord: number; // seeds 1..N by record, then the best points-for among the rest
  week1EndsUtc: string; // the Monday that closes Week 1
  playoffScheduleRank: { source: string; pass: Record<string, number>; rush: Record<string, number> };
  replacementRank: Record<Pos, number>;
  sim: SimConfig;
  keeper: {
    slots: number;
    auctionCurve: Record<Pos, number[]>; // $ the Nth player at a position goes for
    priceByRank: number[];
    priceByPositionRank: Record<Pos, number[]>;
  };
}

export interface Team {
  id: TeamId;
  name: string;
}

export interface Player {
  id: PlayerId;
  name: string;
  pos: Pos;
  nflTeam: string | null;
  bye: number | null;
  espnId: number | null; // shortcut: not in the 2026 export yet; fill on the next ESPN pull and key imports on it
  aliases: string[]; // names as other sources spell them, used only when matching imports
}

export interface RosterSlot {
  teamId: TeamId;
  playerId: PlayerId;
  slot: 'active' | 'ir';
}

export interface Game {
  week: number;
  homeId: TeamId;
  awayId: TeamId;
  homePts: number | null;
  awayPts: number | null;
  status: 'final' | 'scheduled';
}

export interface PlayerWeek {
  playerId: PlayerId;
  week: number;
  teamId: TeamId | null;
  slot: 'start' | 'bench' | 'ir' | 'fa';
  points: number | null;
  projection: number | null;
  opponent: string | null; // "BYE" on a bye week
  opponentRank: number | null;
  rosteredPct: number | null;
  startedPct: number | null;
}

export interface PlayerStats {
  playerId: PlayerId;
  projPerWeek: number | null;
  projRestOfSeason: number | null;
  projRegularRest: number | null;
  seasonPoints: number | null;
  seasonAvg: number | null;
  posRank: string | null;
  availability: 'rostered' | 'waivers' | 'free_agent';
}

export interface Valuation {
  source: string;
  week: number;
  playerId: PlayerId;
  value: number; // 0-100 index, the source's top player = 100
}

export interface Ranking {
  source: string;
  playerId: PlayerId;
  rank: number; // positional rank
}

export interface Injury {
  playerId: PlayerId;
  status: 'Q' | 'OUT' | 'IR';
  note: string;
  since: string | null; // ISO date the status started (IR return = that week + 4)
  returnWeek: number | null; // hand-set estimate; 18 = out for the season
}

export interface News {
  playerId: PlayerId;
  pct: number;
  note: string;
}

export interface Keeper {
  playerId: PlayerId;
  cost: number | null; // null = cannot be kept next season
  contractYear: number; // 2 = locked contract year
  note: string;
}

export interface TransactionLeg {
  playerId: PlayerId;
  fromTeamId: TeamId;
  toTeamId: TeamId;
  rosAtTrade?: number | null; // ESPN rest-of-season points when the trade happened (a snapshot; can't be rebuilt later)
  valueAtTrade?: number | null; // chart value (Peaked/Menton average) when the trade happened
}

export interface Transaction {
  id: string;
  type: 'trade' | 'veto';
  date: string;
  week: number;
  effectiveWeek: number;
  legs: TransactionLeg[];
}

// Volume vs production (FantasyPros stats fitted to league scoring), for the coming Buy & sell view.
export interface Usage {
  playerId: PlayerId;
  pos: Pos;
  g: number; // games
  fpg: number; // league-scoring points per game
  xpg: number; // points per game that volume usually produces
  td: number;
  xtd: number;
  tgt: number | null;
  att: number | null;
  rz: number | null;
  tp: number | null; // target share %
  air: number | null;
  big: number | null;
  ca: number | null; // catchable targets
  dr: number | null; // drops
}

export interface Dataset {
  schemaVersion: 1;
  meta: Meta;
  season: Season;
  teams: Team[];
  players: Player[];
  rosters: RosterSlot[];
  games: Game[];
  playerWeeks: PlayerWeek[];
  playerStats: PlayerStats[];
  valuations: Valuation[];
  rankings: Ranking[];
  injuries: Injury[];
  news: News[];
  keepers: Keeper[];
  transactions: Transaction[];
  usage?: Usage[]; // optional: absent until the FantasyPros stats task first runs
}

// Per-device settings. "My team" lives here, never in the data (DATA-2).
export interface Settings {
  version: 1;
  myTeamId: TeamId | null;
  marketShare: number; // % of value from what managers will accept (charts) vs what scores (model)
  chartWeights: { peaked: number; menton: number; fantasypros: number };
  injuryStrength: number; // 0-1
  useNews: boolean;
  productionRamp: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  myTeamId: null,
  marketShare: 60,
  chartWeights: { peaked: 45, menton: 20, fantasypros: 35 },
  injuryStrength: 0.6,
  useNews: true,
  productionRamp: true,
};
