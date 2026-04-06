/** @type {import('./EnneagramProfile').EnneagramProfile} */
export const mockUser = {
  name: 'Ben Russell',
  typeNumber: 8,
  typeLabel: 'Active Controller',
  subtype: 'SX Subtype',
  integration: {
    levelLabel: 'Low',
    currentStep: 2,
    totalSteps: 5,
  },
  metaMessage: "Be honest and forthright, but don't waste my time.",
  decisionStyle: {
    title: 'Action-Centered',
    strengths: [
      'Thrives under time pressure',
      'Crisis-ready and action-biased',
      'Risk-tolerant when stakes are high',
    ],
    risks: [
      'Unilateral decisions can reduce buy-in',
      'Impatient with details and edge cases',
      'Can fail to consult the right people',
    ],
  },
  teamDynamics: {
    forming: [
      'Sets direction quickly',
      'Clarifies ownership early',
      'May dominate before trust forms',
    ],
    storming: [
      'Confronts conflict directly',
      'Can escalate under resistance',
      'Needs pacing and regulation',
    ],
    norming: [
      'Builds clearer accountability standards',
      'Protects team from unfair dynamics',
      'Should invite quieter voices',
    ],
    performing: [
      'Delegates with confidence',
      'Removes blockers rapidly',
      'Balances force with collaboration',
    ],
  },
  strain: {
    overallLabel: 'Medium',
    maxAxis: 3,
    points: [
      { subject: 'Vocational', value: 2 },
      { subject: 'Interpersonal', value: 2 },
      { subject: 'Environmental', value: 1 },
      { subject: 'Physical', value: 2 },
      { subject: 'Psychological', value: 1 },
      { subject: 'Happiness', value: 1 },
    ],
  },
};
