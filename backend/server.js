'use strict';

/**
 * JOB JOB — VALENCE CORP HIRING SIMULATION
 * A 3–8 player party game clone of Jackbox's Job Job.
 *
 *   lobby -> icebreakers -> [briefing -> interview -> matchups -> round result] x3 -> final
 *
 * Real-game rules implemented here:
 *  - Every applicant gets their own two icebreaker prompts, 5+ words each.
 *  - Every player receives the other applicants' sentences, word by word.
 *  - Interview answers are built only from those words, the question's own
 *    words, and a small rack of free words/punctuation.
 *  - Answers go head-to-head in a bracket; everyone votes, never for their own.
 *  - Match winners score, and so do the people whose words were used.
 *  - Round 1: interview questions. Round 2: office-life hypotheticals.
 *    Round 3: personal statements (M. Bubbles lost the resumes).
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 16;
const MAX_ANSWER_CHARS = 220;

const ICEBREAKER_SECONDS = 150;
const INTERVIEW_SECONDS = 210;
const BRIEFING_SECONDS = 7;
const MATCHUP_SECONDS = 15;
const MATCHUP_RESULT_SECONDS = 9;
const ROUND_RESULT_SECONDS = 10;

const MIN_ICEBREAKER_WORDS = 5;
const MIN_ANSWER_WORDS = 2;

// A matchup pays out this many points in total, split by share of the vote,
// the way the real game does it.
const MATCH_POINTS = 1000;
const WORD_ROYALTY_POINTS = 300;
const QUESTION_WORD_BONUS = 200;
const QUESTION_WORD_CAP = 3;
const CROSS_DEPARTMENT_BONUS = 500;

const COLORS = [
  '#F25C2A',
  '#2E7D61',
  '#7B4B94',
  '#B23A48',
  '#2B6CB0',
  '#8A5A2B',
  '#B8860B',
  '#1B3B48',
  '#4C6B22',
  '#8C3B6B'
];

const TITLES = [
  'CHIEF EXECUTIVE OVERLORD',
  'VP OF SYNERGY',
  'SENIOR VIBE ANALYST',
  'MIDDLE MANAGEMENT',
  'ASSISTANT REGIONAL MASCOT',
  'JUNIOR CLIPBOARD HOLDER',
  'INTERN (UNPAID)',
  'VOLUNTEER',
  'UNPAID CONSULTANT',
  'SECURITY RISK'
];

const ICEBREAKERS = [
  "What's the worst thing you've ever kept in your pockets?",
  'Describe your ideal Friday night in one honest sentence.',
  'What is the most illegal thing you would do for a free lunch?',
  "What's a smell that instantly reminds you of your childhood?",
  "If your boss could read your search history, what's the first thing you'd delete?",
  "What's the longest you've gone without doing laundry, and why?",
  'What animal would be the worst roommate and why?',
  "What's the pettiest reason you've ever stopped talking to someone?",
  'Describe the last dream you actually remember.',
  "What's the most useless skill you have mastered?",
  "What's something you pretend to understand at work?",
  'Who would you call at 3 a.m. and what would you say?',
  "What's the worst gift you've ever received with a straight face?",
  "What's your most embarrassing injury?",
  "What's the strangest thing you've ever done for money?",
  'What would your autobiography be titled?',
  "What's a compliment you've received that sounded like an insult?",
  "What's the dumbest argument you've ever started?",
  'What is currently in the trunk of your car?',
  "What's the worst haircut you've ever paid for?",
  "What's the most dramatic thing you've done over a minor inconvenience?",
  'What lie do you tell most often?',
  "What's a hill you would die on at a family dinner?",
  "What's the weirdest thing you have ever eaten?",
  "What's the last thing you googled at 2 a.m.?",
  'What would you do if you found a wallet with $500 and a name in it?',
  "What's the worst advice you've ever given?",
  'Which of your relatives would be the hardest to explain to an alien?',
  "What's a sound you can't stand, and what does it remind you of?",
  "What's the most expensive thing you've broken and blamed on someone else?",
  "What's something you own that you would fight to keep in a fire?",
  "What's the strangest place you've fallen asleep?",
  "What's a trend you followed and now deeply regret?",
  'What is the most embarrassing song in your playlist?',
  'What did you think was a scam but actually changed your life?',
  'Tell us about a meal you cooked that you would not serve to a guest.',
  'What is the most useless thing you have ever bought twice?',
  'What is the name of your imaginary band, and which instrument do you not play?',
  'Describe the last thing that made you laugh at a funeral-appropriate volume.',
  "What's the pettiest rule you have ever enforced?",
  'Which object in your home would betray you first?',
  'What is the worst thing you have ever said to a pet?',
  "What's a phrase your family says that would confuse a stranger?",
  'What is the most suspicious thing you do in public?',
  "What's the best excuse you have ever invented on the spot?",
  'What would you order at a restaurant that has exactly one item?',
  'What is a small crime you would like to see legalised?',
  "What's the weirdest thing you have ever found in a pocket?",
  "What's the most adult thing you still cannot do?",
  'What is your strategy for avoiding someone you know in public?',
  "What's a compliment you would pay a stranger's dog?",
  'What is the worst smell you have ever described as fine?',
  'What is your least defensible opinion about fruit?',
  'What is the longest you have ever pretended to be busy?',
  "What's a thing you own that has a name?",
  'What would your coworkers be surprised to learn about you?',
  'What is the most dramatic way you have ever left a room?',
  'What is the worst job you have ever invented for yourself?',
  "What's a sound you make when nobody is listening?",
  'What would you put in a time capsule that would confuse the future?',
  'What is your emergency lie?',
  'What is the strangest compliment you have ever given a stranger?',
  "What's the worst thing you have ever done to avoid a phone call?",
  'Describe your perfect sandwich using only emotions.'
];

const INTERVIEW_QUESTIONS = [
  'Tell us about a time you turned a minor inconvenience into a personal vendetta.',
  'Where do you see yourself in five minutes?',
  'What would you do if a coworker ate your lunch and denied it with magic?',
  'Describe your leadership style using only sounds.',
  'How would you handle an angry customer who is somehow also your father?',
  'Why do you want this job, other than the money, the power, and the slushies?',
  "What's your greatest weakness, and who should we fire for it?",
  'If you were a spreadsheet, how many tabs would you have?',
  'Tell us about a time you lied to a room full of people and it worked.',
  'How many flamingos could you manage at once, and why that number?',
  "What's your strategy for looking busy while doing absolutely nothing?",
  'If you had to fire one of your previous bosses, how would you phrase it?',
  'Describe a time you made something worse and called it a learning opportunity.',
  "What's the most corporate phrase you have ever said with a straight face?",
  'If this company were a sandwich, what kind of sandwich would you be?',
  'Tell us about a time you ignored a red flag the size of a building.',
  'How do you handle stress, specifically if the stress is a large bird?',
  'What does "synergy" mean to you, and would you fight for it?',
  'If you were given a truck full of pears and no instructions, what happens next?',
  'Walk us through your process for pretending to take notes.',
  "What's the boldest thing you've ever put on a resume?",
  'How would you improve the color orange?',
  "Tell us about a time you technically didn't lie.",
  "What's your plan if the printer starts making a sound like it knows something?",
  'Why should we hire you instead of the other very similar-looking applicants?',
  "What's a rule you break regularly and would be shocked to be punished for?",
  'Describe the ideal meeting using as few positive words as possible.',
  'Have you ever been the problem? Please be specific.',
  'What would you do with a budget of $12 and unlimited ambition?',
  'Explain your gap in employment using a metaphor involving weather.',
  'Describe your relationship with deadlines using a weather metaphor.',
  'You have five minutes to impress us. Use four.',
  'What is the correct number of emails to have in your inbox?',
  'Tell us about a time you were the most qualified person in the room and it did not matter.',
  'How would you deal with a manager who communicates only in emojis?',
  'What is your process for deciding which meetings to skip?',
  'If your career were a sandwich, what would the filling be and why?',
  'Tell us about a time a plan fell apart and you improved it by accident.',
  'How do you respond to the phrase "we are like a family here"?',
  'What is the most useful thing you have ever learned from a mistake?',
  'Describe a time you were technically correct and socially ruined.',
  'What is your strategy for a meeting that should have been an email?',
  'Tell us about an idea you had that nobody understood until much later.',
  'How would you motivate a team that has already given up?',
  "What is the biggest risk you have taken with someone else's money?",
  'If you were a piece of office equipment, which one would you be and why?',
  'Tell us about a time you said yes and immediately regretted it.',
  'How do you handle a coworker who is always right?',
  'What is the last thing you would put on a resume?',
  'Describe your ideal boss in terms of snacks.',
  'What would you do if you were accidentally put in charge?',
  'Tell us about a time you fixed something nobody asked you to fix.',
  'How do you know when a project is actually finished?',
  'What is the most professional way to say "I told you so"?',
  'Tell us about a time you were late and somehow made it worse.',
  'What is your greatest strength that sounds like a weakness?',
  'What is your greatest weakness that sounds like a threat?',
  'Describe a mistake you would make again on purpose.',
  'How would you spend a budget of exactly one dollar?',
  'Tell us about a time you were completely wrong in public.',
  'What is your policy on crying in the supply closet?',
  'Sell us this pen. It is empty. You are also empty.',
  'Tell us about your relationship with the phrase "per my last email".',
  'How would you handle being copied on 400 emails you do not understand?',
  'What is your five-year plan for the next twenty minutes?',
  'Describe a time you took credit for something a machine did.'
];

const OFFICE_QUESTIONS = [
  'The break room microwave is on fire. What do you do with your remaining four minutes?',
  'You accidentally reply-all to the entire company. What does the email say?',
  'Your boss schedules a meeting that could have been an email. How do you retaliate?',
  'There is one donut left and eleven people. Describe your strategy.',
  'You are stuck in an elevator with the CEO for nine hours. What is your opener?',
  'A coworker keeps saying "circle back." How do you handle this in front of HR?',
  'The office plant has died. Nobody will admit it. What happens next?',
  'You have been asked to plan the holiday party with a budget of eleven dollars.',
  'Someone microwaved fish at 9 a.m. Describe the official incident report.',
  'Your desk neighbor plays music without headphones. What is your diplomatic solution?',
  'You are put in charge of the new "wellness initiative." What is week one?',
  'The printer has achieved consciousness and wants a promotion. How do you respond?',
  'You must present a quarterly update with no numbers and no slides. Go.',
  'Your team lunch has arrived with one item missing. How do you assign blame?',
  'A client asks for a discount because it is their birthday. What do you offer?',
  'You are the last person in the office and the lights will not turn off. Explain.',
  'The company mascot has gone missing. What is your first press statement?',
  'You have been asked to lead a mandatory fun activity. Describe it.',
  'Someone has taken your chair while you were in a meeting. What now?',
  'Your performance review is in five minutes and you have achieved nothing. Improvise.',
  'The fire alarm goes off during your big presentation. What is your closing line?',
  'You are asked to describe the company culture using only a household object.',
  'A rival company offers you a job in the parking lot. How do you negotiate?',
  'You must onboard a new hire who is visibly a raccoon. Where do you start?',
  'The office coffee machine now only dispenses soup. How do you announce this?',
  'You have been assigned a desk next to the printer. What is your survival plan?',
  'A client replies to your email with only a thumbs up. How do you proceed?',
  'The whole team is out of chairs. You are in charge of seating. Go.',
  'Your boss asks for a quick sync at 4:55 on a Friday. Respond.',
  'The Wi-Fi is down and everyone is looking at you. What do you say?',
  'You must write the out-of-office message for the entire department.',
  'A coworker has been using your mug for a month. Describe the confrontation.',
  'The office is being redesigned and your desk is now in the bathroom. Negotiate.',
  'You have to name the conference rooms. Name three.',
  'Someone has left a birthday cake in the break room with no name. What happens?',
  'You are asked to give a tour to a very important visitor who is a dog.',
  'The fire drill happens during your lunch break. Describe your priorities.',
  'You need to explain a spreadsheet to a person who fears numbers.',
  'Your team has one hour and no budget to improve morale. What is the plan?',
  'The copier has jammed in a way nobody has ever seen. What do you tell IT?',
  'You are the only one who knows how the projector works. Use this power.',
  'A meeting has no agenda. You have been asked to take notes. Begin.',
  'The office thermostat is a democracy now. How do you campaign?',
  'You must write a company-wide email about the new recycling rules.',
  'A vendor sends 400 pizzas nobody ordered. What is the official response?',
  'Your manager says let us take this offline. You are already offline.',
  'You have been asked to lead the fun committee against your will.',
  'The elevator music has been replaced by your voice. What do you record?',
  'You are put in charge of the lost and found. Describe your first decision.',
  'A goose has entered the building and is now in payroll. What is your move?',
  'You have to present the quarterly numbers using only interpretive dance.',
  'Someone has scheduled a meeting titled simply "the incident". Do you attend?',
  'You have been asked to describe your job to a medieval peasant.'
];

const STATEMENT_PROMPTS = [
  'I am ___.',
  'My greatest strength is ___.',
  'What I bring to this company is ___.',
  'My goal in five years is ___.',
  'My previous employer would describe me as ___.',
  'The reason I am late today is ___.',
  'My leadership philosophy is ___.',
  'I would describe my work ethic as ___.',
  'The thing I am most proud of is ___.',
  'My ideal work environment is ___.',
  'If hired, the first thing I would change is ___.',
  'My biggest weakness is ___.',
  'I have always been the kind of person who ___.',
  'My coworkers would say I am ___.',
  'I am not afraid of ___.',
  'In ten years I hope to be ___.',
  'My greatest achievement is ___.',
  'The best decision I ever made was ___.',
  'I cannot work without ___.',
  'I would rather quit than ___.',
  'The first thing I notice in a meeting is ___.',
  'My management style can be summarized as ___.',
  'The reason I left my last job is ___.',
  'I am extremely comfortable with ___.',
  'What sets me apart is ___.',
  'My personal brand is ___.',
  'The last thing I want to hear at work is ___.',
  'If I were in charge, the first thing I would do is ___.',
  'I am proudest of ___.',
  'My ideal Monday looks like ___.',
  'The one thing I would tell a new hire is ___.',
  'My relationship with authority is ___.',
  'I measure success in ___.',
  'The strangest thing on my resume is ___.',
  'My legacy at this company will be ___.'
];

const ROUNDS = [
  {
    key: 'interview',
    label: 'ROUND 1',
    title: 'THE INTERVIEW',
    tagline: 'Classic questions. Applicant-supplied vocabulary.',
    promptCount: 2,
    bank: INTERVIEW_QUESTIONS
  },
  {
    key: 'office',
    label: 'ROUND 2',
    title: 'OFFICE LIFE',
    tagline: 'Hypotheticals from the employee handbook. Page 12.',
    promptCount: 2,
    bank: OFFICE_QUESTIONS
  },
  {
    key: 'statement',
    label: 'ROUND 3',
    title: 'THE PERSONAL STATEMENT',
    tagline: 'M. Bubbles lost your resume. Finish both sentences anyway.',
    promptCount: 2,
    bank: STATEMENT_PROMPTS
  }
];

// The cutscene M. Bubbles performs at the top of each round. Every device
// shows it, so nobody has to crowd around a single host screen.
const CUTSCENES = [
  [
    'Welcome to Valence Corp. Take a seat. Not that seat. That seat is for someone we liked more.',
    'Your interview will be conducted with a borrowed vocabulary. Your colleagues donated the words.',
    'Answer honestly. Or dishonestly. We grade on confidence.'
  ],
  [
    'Nobody has been fired yet. Statistically, this is a strong start.',
    'Now: office life. Hypotheticals from the employee handbook, page twelve. The page is sticky.',
    'If you hear a noise from the vents, that is the onboarding coordinator. Do not make eye contact.'
  ],
  [
    'I have misplaced all of your resumes. Every single one. Do not ask how.',
    'For the final exercise, finish two sentences about yourself. Make them count.',
    'The winner receives the job: a lanyard, a mug, and a sense of dread.'
  ]
];

const MEMOS = {
  lobby: [
    'Reminder: the water cooler is sentient and has opinions.',
    'Please do not make eye contact with the filing cabinet.',
    'Forms are available in the lobby. So is regret.',
    'Today’s interviewees are legally required to have fun.'
  ],
  icebreakers: [
    'HR is reading everything you type. Slowly. Out loud.',
    'Five words minimum. Punctuation does not count as personality.',
    'This is a safe space. It is also a monitored space.',
    'Answer honestly. Or do not. We cannot tell the difference.'
  ],
  interview: [
    'Those words belong to your colleagues. Spend them badly.',
    'The question’s own words are legal tender too.',
    'A long answer is not a good answer. It is, however, longer.',
    'If you are stuck, press START FOR ME. HR will pretend not to notice.'
  ],
  matchup: [
    'The panel is watching. The panel is also on its phone.',
    'Vote for the answer that gets the job. Or the funniest one.',
    'You cannot approve yourself. This is the only rule we enforce.',
    'Every word has an author. Every author has a grudge.'
  ],
  matchup_result: [
    'Payroll has been notified. Payroll is a spreadsheet with feelings.',
    'Word royalties are paid immediately and taxed emotionally.',
    'A tie is broken by paperwork. It always is.',
    'The rejected answer will be kept on file for eleven years.'
  ],
  round_result: [
    'Standings are provisional. So is your career.',
    'The champions have been printed and laminated.',
    'Some of you are thriving. The rest are developing.',
    'The next round is being photocopied.'
  ],
  briefing: [
    'Please hold. The host is having a moment.',
    'This cutscene is visible on every device. That is the point.',
    'Do not adjust your phone. Adjust your expectations.'
  ],
  final: [
    'The position has been filled internally. It was always going to be.',
    'Congratulations. Your badge will arrive never.',
    'Please return your lanyard to the bowl by the door.',
    'We will not be in touch. We will, however, remember this.'
  ]
};

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
let wordSequence = 0;

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pick(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function hashString(text) {
  let hash = 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1000003;
  }
  return hash;
}

// Stable per room + phase + match, so a rebroadcast never reshuffles the caption.
function memoFor(room) {
  const pool = MEMOS[room.phase] || MEMOS.lobby;
  if (!pool || !pool.length) return '';
  const key =
    room.code +
    ':' +
    room.phase +
    ':' +
    room.round +
    ':' +
    (room.match ? room.match.matchNumber : 0);
  return pool[hashString(key) % pool.length];
}

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

// Two applicants with the same badge are indistinguishable on the stage, so
// names have to be unique per room (case and spacing do not count as a change).
function nameKey(raw) {
  return cleanName(raw).toLowerCase();
}

function nameTaken(room, name, exceptId) {
  const key = nameKey(name);
  return room.players.some((p) => p.id !== exceptId && nameKey(p.name) === key);
}

function normalizeCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function uniqueCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

function initialsOf(name) {
  const cleaned = String(name || '?')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const PUNCTUATION_TOKENS = ',.!?;:';

function isPunctuationToken(token) {
  return typeof token === 'string' && token.length === 1 && PUNCTUATION_TOKENS.indexOf(token) !== -1;
}

// Words keep their inner apostrophes and hyphens, and punctuation is handed
// back as its own tile, because the real controller is full of punctuation.
function tokenize(text) {
  const tokens = [];
  String(text || '')
    .slice(0, MAX_ANSWER_CHARS)
    .split(/\s+/)
    .forEach((raw) => {
      let piece = raw.replace(/[^\p{L}\p{N}'’.,!?;:-]/gu, '');
      const leading = [];
      const trailing = [];
      while (piece.length && isPunctuationToken(piece.charAt(0))) {
        leading.push(piece.charAt(0));
        piece = piece.slice(1);
      }
      while (piece.length && isPunctuationToken(piece.charAt(piece.length - 1))) {
        trailing.unshift(piece.charAt(piece.length - 1));
        piece = piece.slice(0, -1);
      }
      piece = piece.replace(/^['’-]+|['’-]+$/g, '');
      leading.forEach((mark) => tokens.push(mark));
      if (piece) tokens.push(piece);
      trailing.forEach((mark) => tokens.push(mark));
    });
  return tokens;
}

// Punctuation tiles do not count toward a word minimum.
function countWords(text) {
  return tokenize(text).filter((token) => !isPunctuationToken(token)).length;
}

function joinWords(words) {
  let out = '';
  words.forEach((word) => {
    const text = word.text;
    if (!out) {
      out = text;
      return;
    }
    if (/^[,.;:!?]$/.test(text)) {
      out += text;
      return;
    }
    out += ' ' + text;
  });
  return out;
}

function colorFor(room, authorId) {
  const player = room.players.find((p) => p.id === authorId);
  return player ? player.color : '#1B3B48';
}

function leaderboardOf(room) {
  const sorted = room.players
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Equal scores share a rank and a job title, so a tie never reads as a loss.
  return sorted.map((p) => {
    const rank = 1 + sorted.filter((other) => other.score > p.score).length;
    return {
      id: p.id,
      name: p.name,
      score: p.score,
      color: p.color,
      connected: p.connected,
      rank,
      title: TITLES[Math.min(rank - 1, TITLES.length - 1)]
    };
  });
}

function leadersOf(room) {
  if (!room.players.length) return [];
  const top = Math.max.apply(null, room.players.map((p) => p.score));
  return room.players
    .filter((p) => p.score === top)
    .map((p) => ({ id: p.id, name: p.name, score: p.score, color: p.color }));
}

function stageLabel(matchCount) {
  if (matchCount <= 1) return 'FINAL';
  if (matchCount === 2) return 'SEMIFINAL';
  if (matchCount <= 4) return 'QUARTERFINAL';
  return 'SCREENING ROUND';
}

/* ------------------------------------------------------------------ */
/* Room helpers                                                       */
/* ------------------------------------------------------------------ */

function createRoom(code) {
  return {
    code,
    hostId: null,
    phase: 'lobby',
    round: 0,
    players: [],
    icebreakerPrompts: {},
    icebreakerAnswers: {},
    wordbank: [],
    hands: {},
    roundPrompts: [],
    roundAnswers: {},
    promptsDone: [],
    currentPrompt: null,
    match: null,
    lastMatch: null,
    roundResult: null,
    script: [],
    championIds: {},
    usedPrompts: [],
    timerEnd: null,
    timerHandle: null,
    updatedAt: Date.now()
  };
}

function makePlayer(room, name, socketId) {
  return {
    id: crypto.randomUUID(),
    name,
    score: 0,
    connected: true,
    socketId,
    color: COLORS[room.players.length % COLORS.length]
  };
}

function ensureHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || !host.connected) {
    const nextHost = room.players.find((p) => p.connected);
    if (nextHost) room.hostId = nextHost.id;
  }
}

function stopTimer(room) {
  if (room.timerHandle) clearInterval(room.timerHandle);
  room.timerHandle = null;
  room.timerEnd = null;
}

function startTimer(room, seconds, onComplete) {
  stopTimer(room);
  room.timerEnd = Date.now() + seconds * 1000;
  room.timerHandle = setInterval(() => {
    if (!room.timerEnd) return;
    if (Date.now() >= room.timerEnd) {
      stopTimer(room);
      broadcastRoom(room);
      if (typeof onComplete === 'function') onComplete(room);
      return;
    }
    broadcastRoom(room);
  }, 1000);
  broadcastRoom(room);
}

function broadcastRoom(room) {
  room.updatedAt = Date.now();
  room.players.forEach((player) => {
    if (!player.socketId) return;
    io.to(player.socketId).emit('room_state', personalizedState(room, player));
  });
}

function connectedPlayers(room) {
  return room.players.filter((p) => p.connected);
}

/* ------------------------------------------------------------------ */
/* Word pool, hands, answer resolution                                */
/* ------------------------------------------------------------------ */

function buildWordbank(room) {
  const bank = [];
  room.players.forEach((player) => {
    (room.icebreakerAnswers[player.id] || []).forEach((answer) => {
      tokenize(answer).forEach((text) => {
        wordSequence += 1;
        bank.push({
          id: 'w' + wordSequence,
          text,
          authorId: player.id,
          authorName: player.name
        });
      });
    });
  });
  return bank;
}

// Each applicant is dealt every word the others wrote — never their own — and
// nothing invented by the game, exactly like the real controller.
function buildHands(room) {
  room.players.forEach((player) => {
    const words = room.wordbank.filter((word) => word.authorId !== player.id);
    room.hands[player.id] = shuffle(words);
  });
}

function promptWords(promptText) {
  const seen = new Set();
  const words = [];
  tokenize(promptText).forEach((text) => {
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    words.push({ id: 'q' + words.length, text });
  });
  return words;
}

function answerFor(room, authorId, promptIndex) {
  const slot = room.roundAnswers[authorId];
  if (!slot) return null;
  return slot[promptIndex] || null;
}

function resolveWords(room, player, promptIndex, ids) {
  const hand = room.hands[player.id] || [];
  const prompt = room.roundPrompts[promptIndex];
  const question = prompt ? prompt.words : [];
  const seen = new Set();
  const resolved = [];

  (Array.isArray(ids) ? ids : []).forEach((raw) => {
    const id = String(raw || '');
    if (!id || seen.has(id)) return;
    seen.add(id);

    const held = hand.find((word) => word.id === id);
    if (held) {
      resolved.push({
        id: held.id,
        text: held.text,
        authorId: held.authorId,
        authorName: held.authorName,
        free: !held.authorId
      });
      return;
    }

    const questionMatch = /^q(\d+)$/.exec(id);
    if (questionMatch) {
      const word = question[Number(questionMatch[1])];
      if (word) {
        resolved.push({
          id,
          text: word.text,
          authorId: null,
          authorName: 'THE QUESTION',
          free: true
        });
      }
      return;
    }

  });

  return resolved;
}

function annotateWords(room, words) {
  return words.map((word) => ({
    text: word.text,
    authorId: word.authorId || null,
    authorName: word.authorName || '',
    initial: word.free ? 'JJ' : initialsOf(word.authorName),
    color: word.free ? '#1B3B48' : colorFor(room, word.authorId),
    free: Boolean(word.free)
  }));
}

/* ------------------------------------------------------------------ */
/* Game start + icebreakers                                           */
/* ------------------------------------------------------------------ */

function beginGame(room) {
  room.phase = 'icebreakers';
  room.round = 0;
  room.icebreakerAnswers = {};
  room.wordbank = [];
  room.hands = {};
  room.roundPrompts = [];
  room.roundAnswers = {};
  room.promptsDone = [];
  room.currentPrompt = null;
  room.match = null;
  room.lastMatch = null;
  room.roundResult = null;
  room.usedPrompts = [];
  room.players.forEach((player) => {
    player.score = 0;
  });

  // The real game deals each applicant their own questions, which keeps the
  // resulting word pool weird and wide instead of five versions of one answer.
  const deck = shuffle(ICEBREAKERS);
  room.icebreakerPrompts = {};
  room.script = [];
  room.championIds = {};
  room.players.forEach((player, index) => {
    room.icebreakerPrompts[player.id] = [
      deck[(index * 2) % deck.length],
      deck[(index * 2 + 1) % deck.length]
    ];
  });

  startTimer(room, ICEBREAKER_SECONDS, () => advanceIcebreakers(room));
  broadcastRoom(room);
}

function advanceIcebreakers(room) {
  if (room.phase !== 'icebreakers') return;
  stopTimer(room);
  room.wordbank = buildWordbank(room);
  buildHands(room);
  beginRound(room, 0);
}

function allIcebreakersFiled(room) {
  const connected = connectedPlayers(room);
  if (!connected.length) return false;
  return connected.every((p) => Array.isArray(room.icebreakerAnswers[p.id]));
}

/* ------------------------------------------------------------------ */
/* Round lifecycle                                                    */
/* ------------------------------------------------------------------ */

function pickPrompts(room, roundIndex, count) {
  const bank = ROUNDS[roundIndex].bank;
  const wanted = Math.max(1, count || 2);
  const fresh = bank.filter((prompt) => room.usedPrompts.indexOf(prompt) === -1);
  const source = fresh.length >= wanted ? fresh : bank;
  return shuffle(source).slice(0, wanted);
}

function beginRound(room, roundIndex) {
  room.round = roundIndex;
  room.phase = 'briefing';
  room.roundAnswers = {};
  room.promptsDone = [];
  room.currentPrompt = null;
  room.match = null;
  room.lastMatch = null;
  room.roundResult = null;

  room.championIds = {};
  room.script = CUTSCENES[roundIndex] || [];
  const prompts = pickPrompts(room, roundIndex, ROUNDS[roundIndex].promptCount || 2);
  prompts.forEach((prompt) => room.usedPrompts.push(prompt));

  room.roundPrompts = prompts.map((text) => ({
    text,
    blank: text.indexOf('___') !== -1,
    words: promptWords(text)
  }));

  startTimer(room, BRIEFING_SECONDS, () => beginInterview(room));
  broadcastRoom(room);
}

function beginInterview(room) {
  if (room.phase !== 'briefing') return;
  room.phase = 'interview';
  startTimer(room, INTERVIEW_SECONDS, () => startBrackets(room));
  broadcastRoom(room);
}

function allAnswersFiled(room) {
  const connected = connectedPlayers(room);
  if (!connected.length) return false;
  const need = room.roundPrompts.length || 2;
  return connected.every((player) => {
    const slot = room.roundAnswers[player.id];
    if (!Array.isArray(slot)) return false;
    for (let i = 0; i < need; i += 1) {
      if (!slot[i]) return false;
    }
    return true;
  });
}

function startBrackets(room) {
  if (room.phase !== 'interview') return;
  stopTimer(room);
  room.promptsDone = [];
  room.currentPrompt = null;
  room.match = null;
  startPromptBracket(room, 0);
  advancePrompt(room);
}

/* ------------------------------------------------------------------ */
/* Brackets                                                           */
/* ------------------------------------------------------------------ */

function entriesForPrompt(room, promptIndex) {
  const entries = [];
  room.players.forEach((player) => {
    const answer = answerFor(room, player.id, promptIndex);
    if (!answer) return;
    entries.push({
      authorId: player.id,
      authorName: player.name,
      authorColor: player.color,
      text: answer.text,
      words: answer.words
    });
  });
  return entries;
}

function startPromptBracket(room, promptIndex) {
  const entries = shuffle(entriesForPrompt(room, promptIndex));
  const pairs = [];
  for (let i = 0; i < entries.length; i += 2) {
    pairs.push({
      a: entries[i].authorId,
      b: entries[i + 1] ? entries[i + 1].authorId : null
    });
  }
  room.currentPrompt = {
    promptIndex,
    stage: 1,
    stageCount: pairs.length,
    pairs,
    winners: [],
    matchIndex: 0,
    champion: null,
    done: false
  };
}

function beginMatch(room, prompt, pair) {
  room.match = {
    promptIndex: prompt.promptIndex,
    a: pair.a,
    b: pair.b,
    votes: {},
    stageCount: prompt.stageCount,
    stageLabel: stageLabel(prompt.stageCount),
    matchNumber: prompt.matchIndex + 1,
    isFinal: prompt.stageCount <= 1
  };
  room.phase = 'matchup';
  startTimer(room, MATCHUP_SECONDS, () => tallyMatch(room));
  broadcastRoom(room);
}

function advancePrompt(room) {
  const prompt = room.currentPrompt;
  if (!prompt) {
    finishRound(room);
    return;
  }

  if (!prompt.pairs.length) {
    prompt.champion = null;
    prompt.done = true;
    completePrompt(room);
    return;
  }

  let guard = 0;
  while (guard < 200) {
    guard += 1;

    if (prompt.matchIndex < prompt.pairs.length) {
      const pair = prompt.pairs[prompt.matchIndex];
      if (!pair.b) {
        prompt.winners.push(pair.a);
        prompt.matchIndex += 1;
        continue;
      }
      beginMatch(room, prompt, pair);
      return;
    }

    if (prompt.winners.length === 1) {
      prompt.champion = prompt.winners[0];
      prompt.done = true;
      break;
    }

    if (!prompt.winners.length) {
      prompt.champion = null;
      prompt.done = true;
      break;
    }

    const nextPairs = [];
    for (let i = 0; i < prompt.winners.length; i += 2) {
      nextPairs.push({
        a: prompt.winners[i],
        b: prompt.winners[i + 1] || null
      });
    }
    prompt.pairs = nextPairs;
    prompt.stageCount = nextPairs.length;
    prompt.winners = [];
    prompt.matchIndex = 0;
    prompt.stage += 1;
  }

  completePrompt(room);
}

function completePrompt(room) {
  const prompt = room.currentPrompt;
  if (!prompt) {
    finishRound(room);
    return;
  }

  room.promptsDone.push(prompt.promptIndex);
  room.championIds = room.championIds || {};
  room.championIds['p' + prompt.promptIndex] = prompt.champion;
  room.currentPrompt = null;
  room.match = null;

  const nextIndex = room.roundPrompts.findIndex(
    (_, index) => room.promptsDone.indexOf(index) === -1
  );

  if (nextIndex === -1) {
    finishRound(room);
    return;
  }

  startPromptBracket(room, nextIndex);
  advancePrompt(room);
}

function tallyMatch(room) {
  if (!room.match) return;
  if (room.phase !== 'matchup' && room.phase !== 'interview') return;
  stopTimer(room);

  const match = room.match;
  const promptIndex = match.promptIndex;
  const entryA = entriesForPrompt(room, promptIndex).find((e) => e.authorId === match.a) || null;
  const entryB = entriesForPrompt(room, promptIndex).find((e) => e.authorId === match.b) || null;

  let winnerId = null;
  let loserId = null;
  let counts = { a: 0, b: 0 };
  let totalVotes = 0;
  let tieBreak = false;

  if (entryA && !entryB) {
    winnerId = entryA.authorId;
    loserId = null;
  } else if (entryB && !entryA) {
    winnerId = entryB.authorId;
    loserId = null;
  } else if (entryA && entryB) {
    Object.keys(match.votes).forEach((voterId) => {
      const side = match.votes[voterId];
      if (side === 'a' || side === 'b') {
        counts[side] += 1;
        totalVotes += 1;
      }
    });

    const distinctAuthors = (entry) =>
      new Set(entry.words.filter((w) => w.authorId).map((w) => w.authorId)).size;

    if (counts.a === counts.b) {
      tieBreak = true;
      const authorsA = distinctAuthors(entryA);
      const authorsB = distinctAuthors(entryB);
      if (authorsA !== authorsB) {
        winnerId = authorsA > authorsB ? entryA.authorId : entryB.authorId;
      } else if (entryA.words.length !== entryB.words.length) {
        winnerId = entryA.words.length < entryB.words.length ? entryA.authorId : entryB.authorId;
      } else {
        winnerId = entryA.authorId < entryB.authorId ? entryA.authorId : entryB.authorId;
      }
    } else {
      winnerId = counts.a > counts.b ? entryA.authorId : entryB.authorId;
    }
    loserId = winnerId === entryA.authorId ? entryB.authorId : entryA.authorId;
  }

  const winnerEntry = winnerId === (entryA && entryA.authorId) ? entryA : entryB;

  const awards = [];
  let crossBonus = false;

  const shareOf = (side) => (totalVotes ? Math.round((counts[side] / totalVotes) * 100) : 0);

  // The real game pays a matchup by share of the vote, so a close loss still
  // scores and a clean sweep takes the whole purse.
  let pointsA = 0;
  let pointsB = 0;
  if (entryA && entryB && totalVotes > 0) {
    pointsA = Math.round((MATCH_POINTS * counts.a) / totalVotes);
    pointsB = MATCH_POINTS - pointsA;
  }

  const awardVotes = (entry, side, points) => {
    if (!entry || points <= 0) return;
    const player = room.players.find((p) => p.id === entry.authorId);
    if (!player) return;
    player.score += points;
    awards.push({
      id: player.id,
      name: player.name,
      color: player.color,
      points,
      reason: 'VOTES ' + counts[side] + ' OF ' + totalVotes + ' · ' + shareOf(side) + '%'
    });
  };

  awardVotes(entryA, 'a', pointsA);
  awardVotes(entryB, 'b', pointsB);

  if (winnerEntry) {
    const winnerPlayer = room.players.find((p) => p.id === winnerEntry.authorId);

    const royalties = new Map();
    winnerEntry.words.forEach((word) => {
      if (!word.authorId) return;
      if (word.authorId === winnerEntry.authorId) return;
      if (!royalties.has(word.authorId)) {
        royalties.set(word.authorId, { count: 0, name: word.authorName });
      }
      royalties.get(word.authorId).count += 1;
    });

    royalties.forEach((info, authorId) => {
      const author = room.players.find((p) => p.id === authorId);
      if (!author) return;
      // Paid per word used, so the award matches the "x2" it advertises.
      const points = WORD_ROYALTY_POINTS * info.count;
      author.score += points;
      awards.push({
        id: author.id,
        name: author.name,
        color: author.color,
        points,
        reason: 'WORD ROYALTIES x' + info.count
      });
    });

    // Working in the question's own words pays extra, as it does in the game.
    const questionWordsUsed = new Set();
    winnerEntry.words.forEach((word) => {
      if (word.id && word.id.charAt(0) === 'q') questionWordsUsed.add(word.id);
    });
    const questionCount = Math.min(questionWordsUsed.size, QUESTION_WORD_CAP);
    if (questionCount > 0 && winnerPlayer) {
      const questionPoints = questionCount * QUESTION_WORD_BONUS;
      winnerPlayer.score += questionPoints;
      awards.push({
        id: winnerPlayer.id,
        name: winnerPlayer.name,
        color: winnerPlayer.color,
        points: questionPoints,
        reason: 'QUESTION WORDS x' + questionCount
      });
    }

    if (royalties.size + 1 >= 3) {
      crossBonus = true;
      if (winnerPlayer) winnerPlayer.score += CROSS_DEPARTMENT_BONUS;
      if (winnerPlayer) {
        awards.push({
          id: winnerPlayer.id,
          name: winnerPlayer.name,
          color: winnerPlayer.color,
          points: CROSS_DEPARTMENT_BONUS,
          reason: 'CROSS-DEPARTMENT BONUS'
        });
      }
    }
  }

  const annotate = (entry) =>
    entry
      ? {
          authorId: entry.authorId,
          authorName: entry.authorName,
          authorColor: entry.authorColor,
          text: entry.text,
          words: annotateWords(room, entry.words)
        }
      : null;

  const promptDetails = room.roundPrompts[promptIndex] || null;

  room.lastMatch = {
    promptIndex,
    promptText: promptDetails ? promptDetails.text : '',
    blank: promptDetails ? promptDetails.blank : false,
    stageLabel: match.stageLabel,
    matchNumber: match.matchNumber,
    isFinal: match.isFinal,
    a: annotate(entryA),
    b: annotate(entryB),
    votes: counts,
    totalVotes,
    percent: { a: shareOf('a'), b: shareOf('b') },
    points: { a: pointsA, b: pointsB },
    winnerId,
    loserId,
    winnerSide: winnerId === match.a ? 'a' : 'b',
    tieBreak,
    awards,
    crossBonus,
    leaderboard: leaderboardOf(room)
  };

  room.phase = 'matchup_result';
  startTimer(room, MATCHUP_RESULT_SECONDS, () => afterMatchResult(room));
  broadcastRoom(room);
}

function afterMatchResult(room) {
  if (room.phase !== 'matchup_result') return;
  stopTimer(room);

  const match = room.match;
  const last = room.lastMatch;
  const prompt = room.currentPrompt;

  if (!match || !last) {
    finishRound(room);
    return;
  }

  if (!prompt) {
    finishRound(room);
    return;
  }

  if (last.isFinal) {
    prompt.champion = last.winnerId;
    prompt.done = true;
    room.match = null;
    completePrompt(room);
    return;
  }

  prompt.winners.push(last.winnerId);
  prompt.matchIndex += 1;
  room.match = null;
  advancePrompt(room);
}

function finishRound(room) {
  if (room.phase === 'final') return;
  stopTimer(room);
  room.match = null;
  room.currentPrompt = null;

  const champions = room.roundPrompts.map((prompt, index) => {
    const entries = entriesForPrompt(room, index);
    const championId = room.championIds ? room.championIds['p' + index] : null;
    const champion = entries.find((entry) => entry.authorId === championId) || null;
    return {
      prompt: prompt.text,
      blank: prompt.blank,
      answer: champion ? champion.text : '',
      authorName: champion ? champion.authorName : '',
      authorColor: champion ? champion.authorColor : '#1B3B48',
      complete: Boolean(champion)
    };
  });

  room.roundResult = {
    round: room.round,
    label: ROUNDS[room.round].label,
    title: ROUNDS[room.round].title,
    champions,
    leaderboard: leaderboardOf(room)
  };
  room.phase = 'round_result';

  startTimer(room, ROUND_RESULT_SECONDS, () => afterRoundResult(room));
  broadcastRoom(room);
}

function afterRoundResult(room) {
  if (room.phase !== 'round_result') return;
  stopTimer(room);
  if (room.round >= ROUNDS.length - 1) {
    finishGame(room);
    return;
  }
  beginRound(room, room.round + 1);
}

function finishGame(room) {
  stopTimer(room);
  room.phase = 'final';
  room.lastMatch = null;
  room.currentPrompt = null;
  broadcastRoom(room);
}

function resetForLobby(room) {
  stopTimer(room);
  room.phase = 'lobby';
  room.round = 0;
  room.icebreakerPrompts = {};
  room.icebreakerAnswers = {};
  room.wordbank = [];
  room.hands = {};
  room.roundPrompts = [];
  room.roundAnswers = {};
  room.promptsDone = [];
  room.currentPrompt = null;
  room.match = null;
  room.lastMatch = null;
  room.roundResult = null;
  room.script = [];
  room.championIds = {};
  room.usedPrompts = [];
  room.players.forEach((player) => {
    player.score = 0;
  });
  ensureHost(room);
  broadcastRoom(room);
}

/* ------------------------------------------------------------------ */
/* Personalized state                                                 */
/* ------------------------------------------------------------------ */

function personalizedState(room, player) {
  const base = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: ROUNDS.length,
    hostId: room.hostId,
    myId: player.id,
    timerEnd: room.timerEnd || 0,
    serverNow: Date.now(),
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    memo: memoFor(room),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      color: p.color
    })),
    roundMeta: ROUNDS[room.round]
      ? {
          label: ROUNDS[room.round].label,
          title: ROUNDS[room.round].title,
          tagline: ROUNDS[room.round].tagline,
          promptCount: ROUNDS[room.round].promptCount
        }
      : null
  };

  if (room.phase === 'lobby') return base;

  if (room.phase === 'icebreakers') {
    const answers = room.icebreakerAnswers[player.id] || null;
    base.prompts = room.icebreakerPrompts[player.id] || [];
    base.myAnswers = answers;
    base.filed = Boolean(answers);
    base.filedIds = Object.keys(room.icebreakerAnswers);
    base.minWords = MIN_ICEBREAKER_WORDS;
    return base;
  }

  if (room.phase === 'briefing') {
    base.prompts = room.roundPrompts.map((p) => p.text);
    base.script = room.script || CUTSCENES[room.round] || [];
    return base;
  }

  if (room.phase === 'interview') {
    const hand = room.hands[player.id] || [];
    const slot = room.roundAnswers[player.id] || [null, null];
    base.prompts = room.roundPrompts.map((p) => ({
      text: p.text,
      blank: p.blank,
      words: p.words
    }));
    base.hand = hand.map((word) => ({ id: word.id, text: word.text }));
    base.myAnswers = slot.map((answer) =>
      answer ? { text: answer.text, words: answer.words.map((w) => w.id) } : null
    );
    const need = room.roundPrompts.length || 2;
    base.filedIds = room.players
      .filter((p) => {
        const s = room.roundAnswers[p.id];
        if (!Array.isArray(s)) return false;
        for (let i = 0; i < need; i += 1) {
          if (!s[i]) return false;
        }
        return true;
      })
      .map((p) => p.id);
    base.answerIds = room.players
      .filter((p) => {
        const s = room.roundAnswers[p.id];
        return Array.isArray(s) && s.some(Boolean);
      })
      .map((p) => p.id);
    return base;
  }

  if (room.phase === 'matchup') {
    const match = room.match;
    if (!match) return base;
    const entryA = entriesForPrompt(room, match.promptIndex).find((e) => e.authorId === match.a);
    const entryB = entriesForPrompt(room, match.promptIndex).find((e) => e.authorId === match.b);
    const myAnswer = answerFor(room, player.id, match.promptIndex);
    const votes = { a: 0, b: 0 };
    Object.keys(match.votes).forEach((voterId) => {
      const side = match.votes[voterId];
      if (side === 'a' || side === 'b') votes[side] += 1;
    });
    base.match = {
      promptIndex: match.promptIndex,
      stageLabel: match.stageLabel,
      matchNumber: match.matchNumber,
      promptText: room.roundPrompts[match.promptIndex]
        ? room.roundPrompts[match.promptIndex].text
        : '',
      blank: room.roundPrompts[match.promptIndex]
        ? room.roundPrompts[match.promptIndex].blank
        : false,
      a: entryA ? { text: entryA.text } : null,
      b: entryB ? { text: entryB.text } : null,
      mine: match.a === player.id ? 'a' : match.b === player.id ? 'b' : null,
      myVote: match.votes[player.id] || null,
      canVote: Boolean(myAnswer),
      eligible: Boolean(myAnswer),
      votes,
      votedIds: Object.keys(match.votes),
      voterCount: connectedPlayers(room).filter((p) =>
        Boolean(answerFor(room, p.id, match.promptIndex))
      ).length
    };
    return base;
  }

  if (room.phase === 'matchup_result') {
    base.match = room.lastMatch;
    base.leaderboard = leaderboardOf(room);
    return base;
  }

  if (room.phase === 'round_result') {
    base.roundResult = room.roundResult;
    base.leaderboard = leaderboardOf(room);
    return base;
  }

  if (room.phase === 'final') {
    base.leaderboard = leaderboardOf(room);
    base.leaders = leadersOf(room);
    return base;
  }

  return base;
}

/* ------------------------------------------------------------------ */
/* HTTP routes                                                        */
/* ------------------------------------------------------------------ */

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    game: 'JOB JOB',
    corp: 'VALENCE CORP',
    service: 'applicant-screening-portal',
    openRooms: rooms.size,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.get('/status', (req, res) => {
  res.status(200).json({
    message: 'JOB JOB — VALENCE CORP HIRING SIMULATION',
    notice: 'DO NOT FOLD, SPINDLE, OR MUTILATE',
    health: '/health',
    transport: 'socket.io'
  });
});

// Convenience: the same process can also serve the static frontend.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/* ------------------------------------------------------------------ */
/* Socket handlers                                                    */
/* ------------------------------------------------------------------ */

// A socket can only sit in one room. Without this, creating a new room while
// still attached to an old one leaves a ghost applicant behind and lets the old
// room keep pushing state into the tab.
function detachFromRoom(socket) {
  const code = socket.data && socket.data.code;
  if (!code) return;
  const old = rooms.get(code);
  socket.leave(code);
  socket.data.code = null;
  socket.data.playerId = null;
  if (!old) return;
  const player = old.players.find((p) => p.socketId === socket.id);
  if (!player) return;
  player.connected = false;
  player.socketId = null;
  ensureHost(old);
  broadcastRoom(old);
  maybeAdvance(old);
}

function contextFor(socket) {
  const code = socket.data && socket.data.code;
  const room = code ? rooms.get(code) : null;
  if (!room) return { room: null, player: null };
  const player = room.players.find((p) => p.id === socket.data.playerId) || null;
  return { room, player };
}

function maybeAdvance(room) {
  if (room.phase === 'icebreakers' && allIcebreakersFiled(room)) {
    advanceIcebreakers(room);
    return;
  }
  if (room.phase === 'interview' && allAnswersFiled(room)) {
    startBrackets(room);
    return;
  }
  if (room.phase === 'matchup' && room.match) {
    const match = room.match;
    const eligible = connectedPlayers(room).filter((p) =>
      Boolean(answerFor(room, p.id, match.promptIndex))
    );
    if (eligible.length && eligible.every((p) => Boolean(match.votes[p.id]))) {
      tallyMatch(room);
    }
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', (data, ack) => {
    const name = cleanName(data && data.name);
    if (!name) {
      reply(ack, { ok: false, error: 'Enter a name HR can mispronounce.' });
      return;
    }

    detachFromRoom(socket);
    const code = uniqueCode();
    const room = createRoom(code);
    const player = makePlayer(room, name, socket.id);
    room.players.push(player);
    room.hostId = player.id;
    rooms.set(code, room);

    socket.data.code = code;
    socket.data.playerId = player.id;
    socket.join(code);

    broadcastRoom(room);
    reply(ack, { ok: true, playerId: player.id, code });
  });

  socket.on('join_room', (data, ack) => {
    const code = normalizeCode(data && data.code);
    const name = cleanName(data && data.name);
    const room = rooms.get(code);

    if (!room) {
      reply(ack, { ok: false, error: 'No such room. HR shredded it.' });
      return;
    }
    if (room.phase !== 'lobby') {
      reply(ack, { ok: false, error: 'Interviews are already in session. Re-apply next quarter.' });
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      reply(ack, { ok: false, error: 'This room is at capacity. Try being less popular.' });
      return;
    }
    if (!name) {
      reply(ack, { ok: false, error: 'Enter a name HR can mispronounce.' });
      return;
    }
    if (nameTaken(room, name)) {
      reply(ack, {
        ok: false,
        error: 'That name is already on file. Add a surname, a number, or a personality.'
      });
      return;
    }

    detachFromRoom(socket);
    const player = makePlayer(room, name, socket.id);
    room.players.push(player);
    socket.data.code = code;
    socket.data.playerId = player.id;
    socket.join(code);

    ensureHost(room);
    broadcastRoom(room);
    reply(ack, { ok: true, playerId: player.id, code });
  });

  socket.on('rejoin', (data, ack) => {
    const code = normalizeCode(data && data.code);
    const playerId = String((data && data.playerId) || '');
    const room = rooms.get(code);

    if (!room) {
      reply(ack, { ok: false, error: 'HR lost your file in the move.' });
      return;
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      reply(ack, { ok: false, error: 'Your seat was reclassified as a supply closet.' });
      return;
    }

    if (socket.data && socket.data.playerId && socket.data.playerId !== playerId) {
      detachFromRoom(socket);
    }
    player.connected = true;
    player.socketId = socket.id;
    socket.data.code = code;
    socket.data.playerId = player.id;
    socket.join(code);

    ensureHost(room);
    broadcastRoom(room);
    reply(ack, { ok: true, playerId: player.id, code });
  });

  socket.on('start_game', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (player.id !== room.hostId) {
      reply(ack, { ok: false, error: 'Only the hiring manager can do that.' });
      return;
    }
    if (room.phase !== 'lobby') {
      reply(ack, { ok: false, error: 'Interviews already started.' });
      return;
    }
    if (connectedPlayers(room).length < MIN_PLAYERS) {
      reply(ack, { ok: false, error: 'HR requires at least 3 applicants.' });
      return;
    }
    beginGame(room);
    reply(ack, { ok: true });
  });

  socket.on('submit_icebreakers', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (room.phase !== 'icebreakers') {
      reply(ack, { ok: false, error: 'The questionnaire window has closed.' });
      return;
    }
    if (room.icebreakerAnswers[player.id]) {
      reply(ack, { ok: false, error: 'Your paperwork is already filed.' });
      return;
    }

    const raw = data && Array.isArray(data.answers) ? data.answers : [];
    const answers = [0, 1].map((index) =>
      String(raw[index] || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_ANSWER_CHARS)
    );

    const tooShort = answers.findIndex((answer) => countWords(answer) < MIN_ICEBREAKER_WORDS);
    if (tooShort !== -1) {
      reply(ack, {
        ok: false,
        error: 'Applicant answers must be at least 5 words. HR counts.'
      });
      return;
    }

    room.icebreakerAnswers[player.id] = answers;
    broadcastRoom(room);
    maybeAdvance(room);
    reply(ack, { ok: true });
  });

  socket.on('skip_icebreakers', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player || player.id !== room.hostId) {
      reply(ack, { ok: false, error: 'Only the hiring manager can do that.' });
      return;
    }
    if (room.phase !== 'icebreakers') {
      reply(ack, { ok: false, error: 'Nothing to skip.' });
      return;
    }
    const filled = room.players.filter((p) => Array.isArray(room.icebreakerAnswers[p.id]));
    if (filled.length < 2) {
      reply(ack, { ok: false, error: 'At least two applicants must file before we move on.' });
      return;
    }
    advanceIcebreakers(room);
    reply(ack, { ok: true });
  });

  socket.on('submit_answer', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (room.phase !== 'interview') {
      reply(ack, { ok: false, error: 'The interview is not open.' });
      return;
    }

    const promptIndex = Number(data && data.promptIndex);
    if (
      !Number.isInteger(promptIndex) ||
      promptIndex < 0 ||
      promptIndex >= (room.roundPrompts.length || 2)
    ) {
      reply(ack, { ok: false, error: 'That question does not exist.' });
      return;
    }

    const slot = room.roundAnswers[player.id] || [null, null];
    if (slot[promptIndex]) {
      reply(ack, { ok: false, error: 'That answer is already on file.' });
      return;
    }

    const ids = Array.isArray(data && data.wordIds) ? data.wordIds.slice(0, 80) : [];
    const resolved = resolveWords(room, player, promptIndex, ids);
    const spelledWords = resolved.filter((word) => !isPunctuationToken(word.text)).length;
    if (spelledWords < MIN_ANSWER_WORDS) {
      reply(ack, { ok: false, error: 'HR requires at least two words. Even we have standards.' });
      return;
    }

    const answer = { text: joinWords(resolved), words: resolved };
    slot[promptIndex] = answer;
    room.roundAnswers[player.id] = slot;

    broadcastRoom(room);
    maybeAdvance(room);
    reply(ack, { ok: true, text: answer.text });
  });

  socket.on('cast_vote', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (room.phase !== 'matchup' || !room.match) {
      reply(ack, { ok: false, error: 'Voting is closed.' });
      return;
    }

    const match = room.match;
    const side = data && data.side === 'a' ? 'a' : data && data.side === 'b' ? 'b' : null;
    if (!side) {
      reply(ack, { ok: false, error: 'Pick an answer.' });
      return;
    }
    if (match.votes[player.id]) {
      reply(ack, { ok: false, error: 'You already reviewed this matchup.' });
      return;
    }
    if (!answerFor(room, player.id, match.promptIndex)) {
      reply(ack, { ok: false, error: 'You filed no answer, so you cannot judge this one.' });
      return;
    }
    if (side === 'a' && match.a === player.id) {
      reply(ack, { ok: false, error: 'You cannot approve your own answer.' });
      return;
    }
    if (side === 'b' && match.b === player.id) {
      reply(ack, { ok: false, error: 'You cannot approve your own answer.' });
      return;
    }

    match.votes[player.id] = side;
    broadcastRoom(room);
    maybeAdvance(room);
    reply(ack, { ok: true });
  });

  socket.on('skip_match', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player || player.id !== room.hostId) {
      reply(ack, { ok: false, error: 'Only the hiring manager can do that.' });
      return;
    }
    if (room.phase !== 'matchup') {
      reply(ack, { ok: false, error: 'Nothing to skip.' });
      return;
    }
    tallyMatch(room);
    reply(ack, { ok: true });
  });

  socket.on('next_phase', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (player.id !== room.hostId) {
      reply(ack, { ok: false, error: 'Only the hiring manager can do that.' });
      return;
    }

    if (room.phase === 'briefing') {
      beginInterview(room);
      reply(ack, { ok: true });
      return;
    }
    if (room.phase === 'matchup_result') {
      afterMatchResult(room);
      reply(ack, { ok: true });
      return;
    }
    if (room.phase === 'round_result') {
      afterRoundResult(room);
      reply(ack, { ok: true });
      return;
    }

    reply(ack, { ok: false, error: 'Nothing to advance right now.' });
  });

  socket.on('play_again', (data, ack) => {
    const { room, player } = contextFor(socket);
    if (!room || !player) {
      reply(ack, { ok: false, error: 'You are not checked in.' });
      return;
    }
    if (player.id !== room.hostId) {
      reply(ack, { ok: false, error: 'Only the hiring manager can do that.' });
      return;
    }
    if (room.phase !== 'final') {
      reply(ack, { ok: false, error: 'The fiscal year is not over yet.' });
      return;
    }
    resetForLobby(room);
    reply(ack, { ok: true });
  });

  socket.on('disconnect', () => {
    const { room, player } = contextFor(socket);
    if (!room || !player) return;
    // A stale socket from before a reconnection must not evict the new seat.
    if (player.socketId !== socket.id) return;

    player.connected = false;
    player.socketId = null;

    ensureHost(room);
    broadcastRoom(room);
    maybeAdvance(room);
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const anyConnected = room.players.some((p) => p.connected);
    if (!anyConnected && now - room.updatedAt > 60 * 60 * 1000) {
      stopTimer(room);
      rooms.delete(code);
    }
  });
}, 5 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('JOB JOB screening portal listening on port ' + PORT);
  console.log('Health check: GET /health');
});
