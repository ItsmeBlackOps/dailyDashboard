// C20 — lowercase canonical + new names.
export const MARKETING_ROLES = ['admin', 'mm', 'mam', 'mlead', 'recruiter', 'manager', 'assistantmanager', 'teamlead'];

export const kpiData = {
  total: 1340,
  active: 778,  // 777 + 1 after fixing lowercase 'active' → 'Active'
  po: 157,
  hold: 42,
  backout: 237,
  lowPriority: 32,
  unassigned: 94, // null-status records
};

export const branchData = [
  { name: 'GGR',        count: 669, color: '#635bff' },
  { name: 'LKN',        count: 323, color: '#0cce6b' },
  { name: 'AHM',        count: 231, color: '#f5a623' },
  { name: 'UK',         count: 33,  color: '#ab6bff' },
  { name: 'Unassigned', count: 83,  color: '#6b7280' },
];

// Only vizvainc.com marketing recruiters (silverspaceinc.com = Technical)
export const recruiterData = [
  { name: 'Aakash Khan',         email: 'aakash.khan@vizvainc.com',           total: 18, active: 18, po: 0,  teamLead: 'Aditya Singh' },
  { name: 'Shiwani Kumari',      email: 'shiwani.kumari@vizvainc.com',         total: 17, active: 3,  po: 0,  teamLead: 'Vaibhav Tomar' },
  { name: 'Vinayak Maheshwari',  email: 'vinayak.maheshwari@vizvainc.com',     total: 16, active: 14, po: 1,  teamLead: 'Aditya Singh' },
  { name: 'Sonu Kumar',          email: 'sonu.kumar@vizvainc.com',             total: 16, active: 6,  po: 9,  teamLead: 'Satyam Gupta' },
  { name: 'Nusrat Perween',      email: 'nusrat.perween@vizvainc.com',         total: 15, active: 9,  po: 6,  teamLead: 'Shashank Sharma' },
  { name: 'Nitesh Yadav',        email: 'nitesh.yadav@vizvainc.com',           total: 15, active: 7,  po: 5,  teamLead: 'Raziq Samimi' },
  { name: 'Naman Singh',         email: 'naman.singh@vizvainc.com',            total: 14, active: 5,  po: 3,  teamLead: 'Saurabh Chauhan' },
  { name: 'Manisha Sajnani',     email: 'manisha.sajnani@vizvaconsultancy.co.uk', total: 20, active: 8, po: 4, teamLead: 'UK Lead' },
];

export type CandidateStatus = 'Active' | 'Placement Offer' | 'Hold' | 'Backout' | 'Low Priority' | 'Unassigned';

export interface CandidateRow {
  id: string;
  name: string;
  technology: string;
  branch: string;
  recruiter: string;
  status: CandidateStatus;
  updatedAt: string;
  poDate?: string;
}

export const profilesData: CandidateRow[] = [
  { id: '1',  name: 'Anand Paul Kumbha',            technology: 'Software Engineer',      branch: 'GGR',        recruiter: 'vikas.solanki@vizvainc.com',      status: 'Active',          updatedAt: '2025-10-03' },
  { id: '2',  name: 'Bhanu Prakash Kamarthapu',     technology: 'Software Developer',     branch: 'LKN',        recruiter: 'shreya@vizvainc.com',              status: 'Active',          updatedAt: '2025-10-03' },
  { id: '3',  name: 'Balakrishna Reddy Kondra',     technology: 'Data Analyst',           branch: 'AHM',        recruiter: 'ayan.shekh@vizvainc.com',          status: 'Active',          updatedAt: '2026-01-08' },
  { id: '4',  name: 'Anjireddy Mulamreddy',         technology: 'Data Engineer',          branch: 'GGR',        recruiter: 'vikas.solanki@vizvainc.com',      status: 'Active',          updatedAt: '2026-04-10' },
  { id: '5',  name: 'Aditya Srinivasa Rao Udutha',  technology: 'Data Engineer',          branch: 'LKN',        recruiter: 'aman.s@vizvainc.com',              status: 'Placement Offer', updatedAt: '2026-02-11', poDate: '2026-02-11' },
  { id: '6',  name: 'Akanksha Samindla',            technology: 'Data Engineer',          branch: 'GGR',        recruiter: 'naman.singh@vizvainc.com',         status: 'Placement Offer', updatedAt: '2026-02-11', poDate: '2026-02-11' },
  { id: '7',  name: 'Ankita Sharma',                technology: 'Program Manager',        branch: 'LKN',        recruiter: 'shahzain.haneef@vizvainc.com',     status: 'Placement Offer', updatedAt: '2026-02-11', poDate: '2026-02-11' },
  { id: '8',  name: 'Anusha Hyderaboeni',           technology: 'Data Analyst',           branch: 'AHM',        recruiter: 'ankit.rathod@vizvainc.com',        status: 'Placement Offer', updatedAt: '2026-02-11', poDate: '2026-02-11' },
  { id: '9',  name: 'Dewan Mobin',                  technology: 'Data Analyst',           branch: 'GGR',        recruiter: 'hitesh.tyagi@vizvainc.com',        status: 'Placement Offer', updatedAt: '2026-02-11', poDate: '2026-02-11' },
  { id: '10', name: 'Ayush Bhargava',               technology: 'Mechanical Engineer',    branch: 'GGR',        recruiter: 'shiwani.kumari@vizvainc.com',      status: 'Hold',            updatedAt: '2026-02-11' },
  { id: '11', name: 'Brijesh Patel',                technology: 'Software Developer',     branch: 'GGR',        recruiter: 'shiwani.kumari@vizvainc.com',      status: 'Hold',            updatedAt: '2026-02-11' },
  { id: '12', name: 'Akshit Reddy Gadeela',         technology: 'Data Analyst',           branch: 'GGR',        recruiter: 'shiwani.kumari@vizvainc.com',      status: 'Hold',            updatedAt: '2026-02-11' },
  { id: '13', name: 'Gayathri Mattaparthi',         technology: 'Software Developer',     branch: 'GGR',        recruiter: 'priyansh.kalra@vizvainc.com',      status: 'Hold',            updatedAt: '2026-02-11' },
  { id: '14', name: 'Aniketh Goud Kanthi',          technology: 'Software Engineer',      branch: 'GGR',        recruiter: 'shiwani.kumari@vizvainc.com',      status: 'Hold',            updatedAt: '2026-02-11' },
  { id: '15', name: 'Chitturi Sri Charan',          technology: 'Data Analyst',           branch: 'AHM',        recruiter: 'pushpamjay@vizvainc.com',          status: 'Backout',         updatedAt: '2026-01-28' },
  { id: '16', name: 'Siva Charan Dama',             technology: 'Data Engineer',          branch: 'Unassigned', recruiter: 'nusrat.perween@vizvainc.com',      status: 'Unassigned',      updatedAt: '2026-01-15' },
];

export const statusColors: Record<CandidateStatus, string> = {
  'Active':           'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'Placement Offer':  'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Hold':             'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Backout':          'bg-red-500/15 text-red-400 border-red-500/20',
  'Low Priority':     'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Unassigned':       'bg-gray-500/15 text-gray-400 border-gray-500/20',
};

export const weeklyTrendData = [
  { week: 'W1 Jan', added: 12, po: 8  },
  { week: 'W2 Jan', added: 18, po: 11 },
  { week: 'W3 Jan', added: 9,  po: 6  },
  { week: 'W4 Jan', added: 15, po: 14 },
  { week: 'W1 Feb', added: 21, po: 17 },
  { week: 'W2 Feb', added: 16, po: 13 },
  { week: 'W3 Feb', added: 8,  po: 5  },
  { week: 'W4 Feb', added: 14, po: 9  },
];
