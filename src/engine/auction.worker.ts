// Mock auctions off the main thread. The jobs themselves are in auctionJobs.ts.
import { runAuctionJob, type AuctionRequest } from './auctionJobs.ts';
import { serve } from './workerServe.ts';

serve<AuctionRequest>(runAuctionJob);
