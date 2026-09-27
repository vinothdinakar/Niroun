// Who may see what. A scope is one of:
//   { all: true }     Bond staff: everything
//   { orgId }         a customer's people: their own company's agents and deals
//   { agentId }       an agent itself: its own deals
export interface Scope { all?: true; orgId?: string; agentId?: string }
