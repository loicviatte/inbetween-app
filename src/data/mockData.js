export const MOCK_USER = {
  id: 'user_1',
  name: 'Sofia',
  email: 'sofia@example.com',
  school: 'École de Danse Contemporaine',
};

export const MOCK_FOCUS_POINTS = [
  {
    id: 'fp_1',
    userId: 'user_1',
    nameNormalized: 'legstrength',
    label: 'Leg Strength',
    description:
      'Build explosive power in your legs through targeted plyometric and resistance exercises. Focus on single-leg stability and landing mechanics to translate strength into clean, controlled movement on the floor.',
    count: 3,
  },
  {
    id: 'fp_2',
    userId: 'user_1',
    nameNormalized: 'hiprotation',
    label: 'Hip Rotation',
    description:
      'Develop full range hip mobility and rotational control. Work on slow, intentional circles and figure-eights to create fluidity. Pair with core engagement so rotation originates from your center, not just your legs.',
    count: 2,
  },
  {
    id: 'fp_3',
    userId: 'user_1',
    nameNormalized: 'bodyalignment',
    label: 'Body Alignment',
    description:
      'Train postural awareness through wall-supported holds and mirror work. Focus on stacking joints — ankle, knee, hip, shoulder — and maintaining a neutral spine whether you are upright or in groundwork.',
    count: 2,
  },
];

const now = Date.now();
const day = 86400000;

export const MOCK_CLASS_INPUTS = [
  {
    id: 'ci_1',
    userId: 'user_1',
    input1: 'My legs felt weak during jumps',
    urgency1: 4,
    input2: 'Hip rotation was stiff on the left side',
    urgency2: 3,
    ai_primary_focus: 'fp_1',
    ai_secondary_focus: 'fp_2',
    createdAt: now - 6 * day,
  },
  {
    id: 'ci_2',
    userId: 'user_1',
    input1: 'Need to work on body alignment in transitions',
    urgency1: 5,
    input2: null,
    urgency2: null,
    ai_primary_focus: 'fp_3',
    ai_secondary_focus: null,
    createdAt: now - 4 * day,
  },
  {
    id: 'ci_3',
    userId: 'user_1',
    input1: 'Leg strength still inconsistent, especially single leg',
    urgency1: 4,
    input2: 'Hip rotation improving but needs more range',
    urgency2: 2,
    ai_primary_focus: 'fp_1',
    ai_secondary_focus: 'fp_2',
    createdAt: now - 3 * day,
  },
  {
    id: 'ci_4',
    userId: 'user_1',
    input1: 'Body alignment breaks down when I get tired',
    urgency1: 4,
    input2: null,
    urgency2: null,
    ai_primary_focus: 'fp_3',
    ai_secondary_focus: null,
    createdAt: now - 1 * day,
  },
  {
    id: 'ci_5',
    userId: 'user_1',
    input1: 'Worked on leg strength drills — noticed improvement',
    urgency1: 3,
    input2: null,
    urgency2: null,
    ai_primary_focus: 'fp_1',
    ai_secondary_focus: null,
    createdAt: now,
  },
];

export const MOCK_FOCUS_PROGRESS = [
  { id: 'fpr_1', userId: 'user_1', focusPointId: 'fp_1', classInputId: 'ci_1', priorityScore: 40, createdAt: now - 6 * day },
  { id: 'fpr_2', userId: 'user_1', focusPointId: 'fp_2', classInputId: 'ci_1', priorityScore: 30, createdAt: now - 6 * day },
  { id: 'fpr_3', userId: 'user_1', focusPointId: 'fp_3', classInputId: 'ci_2', priorityScore: 50, createdAt: now - 4 * day },
  { id: 'fpr_4', userId: 'user_1', focusPointId: 'fp_1', classInputId: 'ci_3', priorityScore: 40, createdAt: now - 3 * day },
  { id: 'fpr_5', userId: 'user_1', focusPointId: 'fp_2', classInputId: 'ci_3', priorityScore: 20, createdAt: now - 3 * day },
  { id: 'fpr_6', userId: 'user_1', focusPointId: 'fp_3', classInputId: 'ci_4', priorityScore: 40, createdAt: now - 1 * day },
  { id: 'fpr_7', userId: 'user_1', focusPointId: 'fp_1', classInputId: 'ci_5', priorityScore: 30, createdAt: now },
];

export const MOCK_NOTES = [
  {
    id: 'note_1',
    userId: 'user_1',
    title: 'Warm-up reminders',
    content: 'Always start with hip circles and ankle rolls before any jump sequence. 5 minutes minimum.\n\nRemember to breathe through the transitions.',
    videoClips: [],
    linkedClassInputId: 'ci_3',
    createdAt: now - 5 * day,
    updatedAt: now - 5 * day,
  },
  {
    id: 'note_2',
    userId: 'user_1',
    title: 'Choreography notes',
    content: 'The third phrase needs more attack on counts 5-6. Think sharp not heavy.\n\nArms: lead with the elbow, not the wrist.',
    videoClips: [],
    linkedClassInputId: null,
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day,
  },
];
