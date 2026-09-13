// departments.js
// The roster groups people under department header rows. Discord shows short
// names and the sheet uses its own header text, and this is the one place that
// maps between them.
//
// Matching ignores case and extra spaces, because the sheet mixes
// "STUDIO DEVELOPMENT TEAM" with "Human Resources & Staff Operations".
//
// `hiring` marks the four departments HR hires into with /hire. Every department
// can still be picked when someone listed in two of them needs a rating changed.

const DEPARTMENTS = [
  { value: 'community_outreach', label: 'Community Outreach', section: 'COMMUNITY OUTREACH DEPARTMENT', hiring: true },
  { value: 'human_resources', label: 'Human Resources', section: 'Human Resources & Staff Operations', hiring: true },
  { value: 'public_relations', label: 'Public Relations', section: 'PUBLIC RELATIONS TEAM', hiring: true },
  { value: 'development', label: 'Development', section: 'STUDIO DEVELOPMENT TEAM', hiring: true },
  { value: 'executive_ownership', label: 'Executive Ownership', section: 'Studio Executive Ownership', hiring: false },
  { value: 'board_of_directors', label: 'Board of Directors', section: 'Executive Board of Directors', hiring: false },
  { value: 'it_support', label: 'IT Support', section: 'STUDIO IT SUPPORT', hiring: false },
  { value: 'sales_operations', label: 'Sales Operations', section: 'SALES Operations DEPARTMENT', hiring: false },
];

const squash = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const byValue = (value) => DEPARTMENTS.find((d) => d.value === value) || null;
const bySection = (section) => DEPARTMENTS.find((d) => squash(d.section) === squash(section)) || null;
const labelFor = (section) => bySection(section)?.label || section || 'an unknown department';

const hiringChoices = () => DEPARTMENTS.filter((d) => d.hiring).map((d) => ({ name: d.label, value: d.value }));
const allChoices = () => DEPARTMENTS.map((d) => ({ name: d.label, value: d.value }));

module.exports = { DEPARTMENTS, squash, byValue, bySection, labelFor, hiringChoices, allChoices };
