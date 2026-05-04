// C20 — server-side role alias helpers, mirror of the frontend shim.
//
// After migration, the DB stores new role names (manager,
// assistantManager, teamLead, expert) plus a `team` field. ~40 sites
// across sockets/controllers/services still compare against legacy
// role strings ('mm', 'mam', 'mlead', 'am', 'lead', 'user'). Rather
// than rewriting all of them at once, the auth middleware uses
// `toLegacyRole(role, team)` to translate role to legacy form when
// populating req.user and socket.data.user. Every downstream legacy
// comparison keeps working unchanged.
//
// Team is required for the assistantManager / teamLead disambiguation
// (technical → am/lead, marketing → mam/mlead). Missing team falls
// back to marketing because that is where the bulk of users live.

export const toLegacyRole = (role, team) => {
  const r = (role || '').toString().toLowerCase().trim();
  const t = (team || '').toString().toLowerCase().trim();
  switch (r) {
    case 'manager':
      return 'mm';
    case 'assistantmanager':
      return t === 'technical' ? 'am' : 'mam';
    case 'teamlead':
      return t === 'technical' ? 'lead' : 'mlead';
    case 'expert':
      return 'user';
    default:
      return r;
  }
};
