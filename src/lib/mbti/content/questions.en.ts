import type { QuestionContent } from '@/lib/mbti/content/types'

/**
 * English wording for the 60 questions, keyed by `Question.id`.
 *
 * Answer `a` always scores the FIRST pole of the question's axis (E, S, T, J) and `b` the
 * second (I, N, F, P). That mapping lives in `AXIS_POLES`; getting it backwards in a
 * content file would invert an entire axis silently, so the ordering here is a contract,
 * not a layout choice.
 *
 * Written as everyday situations rather than trait statements ("After a long week you
 * recharge by..." not "I am an extraverted person"). People answer questions about their
 * behaviour more honestly than questions about their identity.
 */
export const QUESTIONS_EN: Record<number, QuestionContent> = {
  // --- E / I ---
  1: {
    prompt: 'After a long week, you recharge by',
    a: 'going out with people',
    b: 'having time to yourself',
  },
  5: {
    prompt: 'At a party where you know almost nobody, you',
    a: 'introduce yourself to strangers',
    b: 'stay near whoever you came with',
  },
  9: {
    prompt: 'When you get good news, you',
    a: 'tell someone straight away',
    b: 'sit with it for a while first',
  },
  13: {
    prompt: 'In a group discussion, you',
    a: 'think out loud',
    b: 'form the thought before you speak',
  },
  17: {
    prompt: 'Your ideal weekend has',
    a: 'plans with several people',
    b: 'long stretches of nothing scheduled',
  },
  21: {
    prompt: 'Stuck on a hard problem, you would rather',
    a: 'talk it through with someone',
    b: 'work it out on your own',
  },
  25: {
    prompt: 'A day packed with meetings leaves you',
    a: 'energised',
    b: 'drained',
  },
  29: {
    prompt: 'A stranger sits next to you on a long trip. You',
    a: 'start a conversation',
    b: 'put your headphones on',
  },
  33: {
    prompt: 'In a new team, people get to know you',
    a: 'quickly',
    b: 'slowly',
  },
  37: {
    prompt: 'A silence in a conversation feels',
    a: 'like something to fill',
    b: 'perfectly comfortable',
  },
  41: {
    prompt: 'You would rather have',
    a: 'many friendly acquaintances',
    b: 'a few deep friendships',
  },
  45: {
    prompt: 'When something upsets you, you',
    a: 'need to talk about it',
    b: 'need space before you talk',
  },
  49: {
    prompt: 'Your phone rings from an unknown number. You',
    a: 'answer it',
    b: 'let it go to voicemail',
  },
  53: {
    prompt: 'At a workshop, you get more out of',
    a: 'the group exercises',
    b: 'the time working alone',
  },
  57: {
    prompt: 'After a long, great conversation you feel',
    a: 'lifted',
    b: 'ready for quiet',
  },

  // --- S / N ---
  2: {
    prompt: 'You trust more',
    a: 'what you can observe directly',
    b: 'what you sense is coming',
  },
  6: {
    prompt: 'Handed a set of instructions, you',
    a: 'follow them step by step',
    b: 'skim them and work it out',
  },
  10: {
    prompt: 'You are drawn to',
    a: 'practical detail',
    b: 'the big idea behind it',
  },
  14: {
    prompt: 'When someone explains a plan, you first want',
    a: 'the specifics',
    b: 'the point of it',
  },
  18: {
    prompt: 'You describe something that happened by saying',
    a: 'what happened',
    b: 'what it meant',
  },
  22: {
    prompt: 'You would rather work on something',
    a: 'concrete and real',
    b: 'possible but unproven',
  },
  26: {
    prompt: 'You tend to notice',
    a: 'what is actually there',
    b: 'what it could become',
  },
  30: {
    prompt: 'Your memory holds on to',
    a: 'facts and details',
    b: 'impressions and connections',
  },
  34: {
    prompt: 'A good idea is one that',
    a: 'works right now',
    b: 'opens something up',
  },
  38: {
    prompt: 'You are more comfortable with',
    a: 'a proven method',
    b: 'an untested one that might be better',
  },
  42: { prompt: 'When you cook, you', a: 'follow the recipe', b: 'improvise' },
  46: {
    prompt: 'Your mind is usually',
    a: 'grounded in what is in front of you',
    b: 'somewhere ahead of it',
  },
  50: { prompt: 'In a museum you', a: 'read the placards', b: 'just look' },
  54: {
    prompt: 'You would describe yourself as more',
    a: 'practical',
    b: 'imaginative',
  },
  58: { prompt: 'For you, facts are', a: 'the point', b: 'the starting point' },

  // --- T / F ---
  3: {
    prompt: 'When a friend brings you a problem, you first',
    a: 'help them solve it',
    b: 'make sure they feel heard',
  },
  7: {
    prompt: 'A good decision is one that is',
    a: 'logically sound',
    b: 'right for the people involved',
  },
  11: { prompt: 'You would rather be seen as', a: 'fair', b: 'kind' },
  15: {
    prompt: 'Giving someone hard feedback, you',
    a: 'say it plainly',
    b: 'shape it so it lands gently',
  },
  19: {
    prompt: 'In an argument, you focus on',
    a: 'who is right',
    b: 'how everyone is feeling',
  },
  23: {
    prompt: 'You judge a plan by',
    a: 'whether it holds up',
    b: 'how it affects people',
  },
  27: { prompt: 'Criticism of your work feels', a: 'useful', b: 'personal' },
  31: {
    prompt: 'In a conflict at work, you look for',
    a: 'the objectively correct answer',
    b: 'what keeps the team whole',
  },
  35: {
    prompt: 'Rules should be',
    a: 'applied consistently',
    b: 'bent when the situation calls for it',
  },
  39: { prompt: 'You value', a: 'truth', b: 'harmony' },
  43: {
    prompt: 'Watching a sad film, you',
    a: 'stay a step back from it',
    b: 'get pulled all the way in',
  },
  47: {
    prompt: 'When someone starts crying, your instinct is to',
    a: 'find out what caused it',
    b: 'comfort them',
  },
  51: {
    prompt: 'A team decision should come down to',
    a: 'the strongest argument',
    b: 'the widest agreement',
  },
  55: {
    prompt: 'You would rather be told',
    a: 'the honest thing',
    b: 'the encouraging thing',
  },
  59: { prompt: 'You trust', a: 'your analysis', b: 'your gut about people' },

  // --- J / P ---
  4: {
    prompt: 'A trip is better when it is',
    a: 'planned out',
    b: 'left open',
  },
  8: {
    prompt: 'A deadline is something you',
    a: 'finish well before',
    b: 'work toward right up to',
  },
  12: {
    prompt: 'Your workspace is usually',
    a: 'ordered',
    b: 'a productive mess',
  },
  16: {
    prompt: 'You feel better once a decision is',
    a: 'made',
    b: 'still open',
  },
  20: {
    prompt: 'A to-do list is',
    a: 'how you work',
    b: 'something you write and then lose',
  },
  24: {
    prompt: 'Plans changing at the last minute feels',
    a: 'annoying',
    b: 'fine, sometimes better',
  },
  28: {
    prompt: 'You would rather',
    a: 'know what is happening tomorrow',
    b: 'see what tomorrow brings',
  },
  32: {
    prompt: 'You start a new project by',
    a: 'mapping it out',
    b: 'diving in',
  },
  36: {
    prompt: 'Unfinished things',
    a: 'nag at you',
    b: 'do not really bother you',
  },
  40: { prompt: 'You pack for a trip', a: 'days ahead', b: 'the night before' },
  44: { prompt: 'Routine feels', a: 'steadying', b: 'confining' },
  48: {
    prompt: 'When you go shopping, you',
    a: 'bring a list',
    b: 'see what is there',
  },
  52: {
    prompt: 'You would rather your calendar be',
    a: 'full and clear',
    b: 'mostly empty',
  },
  56: {
    prompt: 'The rules of a game should be',
    a: 'settled before you start',
    b: 'worked out as you play',
  },
  60: {
    prompt: 'You finish things',
    a: 'before you have to',
    b: 'exactly when you have to',
  },
}
