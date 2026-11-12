import type { TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { useRoute } from './router.ts';

// Which team the "My Team" section is showing (Nov 12, item 4). It starts on your own team and the
// dropdown in the header moves it; the choice rides in ?team= so it survives a reload, a shared link
// and a hop between the section's pages.
export function useViewTeam(): { team: TeamId; mine: boolean; setTeam: (t: TeamId) => void } {
  const { idx, settings } = useLeague();
  const { route, query, replace } = useRoute();
  const asked = Number(query.get('team'));
  const fallback = settings.myTeamId ?? idx.teamIds[0]!;
  const team = idx.teams.has(asked) ? asked : fallback;
  const setTeam = (t: TeamId) => {
    const q = new URLSearchParams(query);
    if (t === settings.myTeamId) q.delete('team'); else q.set('team', String(t));
    replace(route, q.toString());
  };
  return { team, mine: team === settings.myTeamId, setTeam };
}
