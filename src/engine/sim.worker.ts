import { oddsHistory, simulate, type SimInput } from './sim.ts';
import { serve } from './workerServe.ts';

export type SimRequest = { kind: 'odds'; input: SimInput } | { kind: 'history'; input: SimInput; thru: number };

serve<SimRequest>((req) => (req.kind === 'odds' ? simulate(req.input) : oddsHistory(req.input, req.thru)));
