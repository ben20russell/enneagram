export interface EnneagramProfile {
  name: string;
  typeNumber: number;
  typeLabel: string;
  subtype: string;
  integration: {
    levelLabel: string;
    currentStep: number;
    totalSteps: number;
  };
  metaMessage: string;
  decisionStyle: {
    title: string;
    strengths: string[];
    risks: string[];
  };
  teamDynamics: {
    forming: string[];
    storming: string[];
    norming: string[];
    performing: string[];
  };
  strain: {
    overallLabel: string;
    maxAxis: number;
    points: Array<{
      subject: string;
      value: number;
    }>;
  };
}
