/**
 * Exercise catalogue.
 *
 * `kind` decides which fields a logged set needs:
 *   weight_reps       load + reps          (bench, squat, curl)
 *   bodyweight_reps   reps, optional +load (pull-up, push-up, dip)
 *   duration          seconds              (plank, dead hang)
 *   distance_duration distance + time      (run, row, bike)
 *
 * `met` is the Compendium of Physical Activities value used for the calorie
 * estimate. Resistance work: 6.0 vigorous multi-joint, 3.5 isolation/light.
 * `increment` is the smallest sane jump in POUNDS for that equipment; the
 * coach rounds every recommendation to it.
 * `perSide` means the number a lifter says is the load in one hand.
 */

export const MUSCLES = [
  'chest', 'back', 'lats', 'traps', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio',
];

const E = (id, name, kind, opts) => ({
  id, name, kind,
  aliases: [], equipment: 'other', primary: [], secondary: [],
  met: 5, increment: 5, repRange: [8, 12], compound: false, perSide: false,
  ...opts,
});

export const EXERCISES = [
  // ---- Barbell: push -------------------------------------------------
  E('barbell-bench-press', 'Barbell Bench Press', 'weight_reps', {
    aliases: ['bench', 'bench press', 'barbell bench', 'flat bench', 'flat barbell bench', 'bench presses'],
    equipment: 'barbell', primary: ['chest'], secondary: ['triceps', 'shoulders'],
    met: 6, increment: 5, repRange: [5, 8], compound: true,
  }),
  E('incline-barbell-press', 'Incline Barbell Press', 'weight_reps', {
    aliases: ['incline bench', 'incline barbell bench', 'incline press', 'incline bench press'],
    equipment: 'barbell', primary: ['chest'], secondary: ['shoulders', 'triceps'],
    met: 6, increment: 5, repRange: [6, 10], compound: true,
  }),
  E('overhead-press', 'Overhead Press', 'weight_reps', {
    aliases: ['ohp', 'overhead press', 'military press', 'strict press', 'shoulder press', 'standing press'],
    equipment: 'barbell', primary: ['shoulders'], secondary: ['triceps', 'core'],
    met: 6, increment: 5, repRange: [5, 8], compound: true,
  }),
  E('close-grip-bench', 'Close-Grip Bench Press', 'weight_reps', {
    aliases: ['close grip bench', 'close grip bench press', 'close grips'],
    equipment: 'barbell', primary: ['triceps'], secondary: ['chest'],
    met: 6, increment: 5, repRange: [6, 10], compound: true,
  }),

  // ---- Barbell: pull / hinge ----------------------------------------
  E('deadlift', 'Deadlift', 'weight_reps', {
    aliases: ['deadlift', 'dead lift', 'conventional deadlift', 'deads', 'dl'],
    equipment: 'barbell', primary: ['hamstrings', 'glutes', 'back'], secondary: ['traps', 'forearms', 'core'],
    met: 6, increment: 10, repRange: [3, 5], compound: true,
  }),
  E('romanian-deadlift', 'Romanian Deadlift', 'weight_reps', {
    aliases: ['rdl', 'romanian deadlift', 'romanians', 'stiff leg deadlift', 'stiff legged deadlift'],
    equipment: 'barbell', primary: ['hamstrings', 'glutes'], secondary: ['back'],
    met: 6, increment: 5, repRange: [6, 10], compound: true,
  }),
  E('barbell-row', 'Barbell Row', 'weight_reps', {
    aliases: ['barbell row', 'bent over row', 'bent-over row', 'pendlay row', 'bb row', 'barbell rows'],
    equipment: 'barbell', primary: ['back', 'lats'], secondary: ['biceps', 'traps'],
    met: 6, increment: 5, repRange: [6, 10], compound: true,
  }),
  E('rack-pull', 'Rack Pull', 'weight_reps', {
    aliases: ['rack pull', 'rack pulls'],
    equipment: 'barbell', primary: ['back', 'traps'], secondary: ['glutes', 'forearms'],
    met: 6, increment: 10, repRange: [3, 6], compound: true,
  }),
  E('barbell-shrug', 'Barbell Shrug', 'weight_reps', {
    aliases: ['shrug', 'shrugs', 'barbell shrug', 'barbell shrugs'],
    equipment: 'barbell', primary: ['traps'], secondary: ['forearms'],
    met: 5, increment: 10, repRange: [8, 15],
  }),
  E('power-clean', 'Power Clean', 'weight_reps', {
    aliases: ['power clean', 'clean', 'cleans'],
    equipment: 'barbell', primary: ['back', 'quads', 'traps'], secondary: ['shoulders', 'glutes'],
    met: 6, increment: 5, repRange: [2, 5], compound: true,
  }),

  // ---- Barbell: legs -------------------------------------------------
  E('back-squat', 'Back Squat', 'weight_reps', {
    aliases: ['squat', 'squats', 'back squat', 'barbell squat', 'high bar squat', 'low bar squat'],
    equipment: 'barbell', primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'],
    met: 6, increment: 5, repRange: [5, 8], compound: true,
  }),
  E('front-squat', 'Front Squat', 'weight_reps', {
    aliases: ['front squat', 'front squats'],
    equipment: 'barbell', primary: ['quads'], secondary: ['glutes', 'core'],
    met: 6, increment: 5, repRange: [5, 8], compound: true,
  }),
  E('hip-thrust', 'Barbell Hip Thrust', 'weight_reps', {
    aliases: ['hip thrust', 'hip thrusts', 'barbell hip thrust', 'glute bridge'],
    equipment: 'barbell', primary: ['glutes'], secondary: ['hamstrings'],
    met: 5, increment: 10, repRange: [8, 12], compound: true,
  }),
  E('walking-lunge', 'Walking Lunge', 'weight_reps', {
    aliases: ['lunge', 'lunges', 'walking lunge', 'walking lunges'],
    equipment: 'dumbbell', primary: ['quads', 'glutes'], secondary: ['hamstrings'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),
  E('bulgarian-split-squat', 'Bulgarian Split Squat', 'weight_reps', {
    aliases: ['bulgarian split squat', 'bulgarians', 'split squat', 'rear foot elevated split squat'],
    equipment: 'dumbbell', primary: ['quads', 'glutes'], secondary: ['hamstrings'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),

  // ---- Dumbbell ------------------------------------------------------
  E('dumbbell-bench-press', 'Dumbbell Bench Press', 'weight_reps', {
    aliases: ['dumbbell bench', 'dumbbell bench press', 'db bench', 'dumbbell press', 'db press', 'dumbbell chest press'],
    equipment: 'dumbbell', primary: ['chest'], secondary: ['triceps', 'shoulders'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),
  E('incline-dumbbell-press', 'Incline Dumbbell Press', 'weight_reps', {
    aliases: ['incline dumbbell press', 'incline dumbbell bench', 'incline db press', 'incline dumbbells'],
    equipment: 'dumbbell', primary: ['chest'], secondary: ['shoulders', 'triceps'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),
  E('dumbbell-shoulder-press', 'Dumbbell Shoulder Press', 'weight_reps', {
    aliases: ['dumbbell shoulder press', 'db shoulder press', 'seated dumbbell press', 'arnold press'],
    equipment: 'dumbbell', primary: ['shoulders'], secondary: ['triceps'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),
  E('dumbbell-row', 'Dumbbell Row', 'weight_reps', {
    aliases: ['dumbbell row', 'db row', 'one arm row', 'single arm row', 'dumbbell rows'],
    equipment: 'dumbbell', primary: ['lats', 'back'], secondary: ['biceps'],
    met: 6, increment: 5, repRange: [8, 12], compound: true, perSide: true,
  }),
  E('lateral-raise', 'Lateral Raise', 'weight_reps', {
    aliases: ['lateral raise', 'lateral raises', 'side raise', 'side raises', 'laterals', 'side lateral raise'],
    equipment: 'dumbbell', primary: ['shoulders'], secondary: [],
    met: 3.5, increment: 5, repRange: [12, 20], perSide: true,
  }),
  E('rear-delt-fly', 'Rear Delt Fly', 'weight_reps', {
    aliases: ['rear delt fly', 'rear delt flys', 'reverse fly', 'rear delts', 'reverse pec deck'],
    equipment: 'dumbbell', primary: ['shoulders'], secondary: ['back'],
    met: 3.5, increment: 5, repRange: [12, 20], perSide: true,
  }),
  E('dumbbell-curl', 'Dumbbell Curl', 'weight_reps', {
    aliases: ['dumbbell curl', 'db curl', 'bicep curl', 'biceps curl', 'curl', 'curls', 'alternating curl'],
    equipment: 'dumbbell', primary: ['biceps'], secondary: ['forearms'],
    met: 3.5, increment: 5, repRange: [8, 12], perSide: true,
  }),
  E('hammer-curl', 'Hammer Curl', 'weight_reps', {
    aliases: ['hammer curl', 'hammer curls', 'hammers'],
    equipment: 'dumbbell', primary: ['biceps', 'forearms'], secondary: [],
    met: 3.5, increment: 5, repRange: [8, 12], perSide: true,
  }),
  E('dumbbell-fly', 'Dumbbell Fly', 'weight_reps', {
    aliases: ['dumbbell fly', 'dumbbell flys', 'chest fly', 'flys', 'flies', 'pec fly'],
    equipment: 'dumbbell', primary: ['chest'], secondary: [],
    met: 3.5, increment: 5, repRange: [10, 15], perSide: true,
  }),
  E('goblet-squat', 'Goblet Squat', 'weight_reps', {
    aliases: ['goblet squat', 'goblet squats'],
    equipment: 'dumbbell', primary: ['quads', 'glutes'], secondary: ['core'],
    met: 6, increment: 5, repRange: [8, 15], compound: true,
  }),

  // ---- Machine / cable ----------------------------------------------
  E('lat-pulldown', 'Lat Pulldown', 'weight_reps', {
    aliases: ['lat pulldown', 'lat pull down', 'pulldown', 'pull down', 'lat pulldowns'],
    equipment: 'cable', primary: ['lats'], secondary: ['biceps'],
    met: 5, increment: 10, repRange: [8, 12], compound: true,
  }),
  E('seated-cable-row', 'Seated Cable Row', 'weight_reps', {
    aliases: ['cable row', 'seated row', 'seated cable row', 'cable rows'],
    equipment: 'cable', primary: ['back'], secondary: ['biceps', 'lats'],
    met: 5, increment: 10, repRange: [8, 12], compound: true,
  }),
  E('leg-press', 'Leg Press', 'weight_reps', {
    aliases: ['leg press', 'leg presses'],
    equipment: 'machine', primary: ['quads', 'glutes'], secondary: ['hamstrings'],
    met: 5, increment: 10, repRange: [8, 15], compound: true,
  }),
  E('leg-extension', 'Leg Extension', 'weight_reps', {
    aliases: ['leg extension', 'leg extensions', 'quad extension', 'leg ext'],
    equipment: 'machine', primary: ['quads'], secondary: [],
    met: 3.5, increment: 10, repRange: [10, 15],
  }),
  E('leg-curl', 'Leg Curl', 'weight_reps', {
    aliases: ['leg curl', 'leg curls', 'hamstring curl', 'lying leg curl', 'seated leg curl'],
    equipment: 'machine', primary: ['hamstrings'], secondary: [],
    met: 3.5, increment: 10, repRange: [10, 15],
  }),
  E('chest-press-machine', 'Chest Press Machine', 'weight_reps', {
    aliases: ['chest press machine', 'machine chest press', 'machine press'],
    equipment: 'machine', primary: ['chest'], secondary: ['triceps'],
    met: 5, increment: 10, repRange: [8, 12], compound: true,
  }),
  E('pec-deck', 'Pec Deck', 'weight_reps', {
    aliases: ['pec deck', 'machine fly', 'butterfly'],
    equipment: 'machine', primary: ['chest'], secondary: [],
    met: 3.5, increment: 10, repRange: [10, 15],
  }),
  E('tricep-pushdown', 'Tricep Pushdown', 'weight_reps', {
    aliases: ['tricep pushdown', 'triceps pushdown', 'pushdown', 'push down', 'rope pushdown', 'tricep extension'],
    equipment: 'cable', primary: ['triceps'], secondary: [],
    met: 3.5, increment: 5, repRange: [10, 15],
  }),
  E('cable-curl', 'Cable Curl', 'weight_reps', {
    aliases: ['cable curl', 'cable curls', 'rope curl'],
    equipment: 'cable', primary: ['biceps'], secondary: ['forearms'],
    met: 3.5, increment: 5, repRange: [10, 15],
  }),
  E('face-pull', 'Face Pull', 'weight_reps', {
    aliases: ['face pull', 'face pulls'],
    equipment: 'cable', primary: ['shoulders'], secondary: ['back', 'traps'],
    met: 3.5, increment: 5, repRange: [12, 20],
  }),
  E('calf-raise', 'Calf Raise', 'weight_reps', {
    aliases: ['calf raise', 'calf raises', 'standing calf raise', 'seated calf raise', 'calves'],
    equipment: 'machine', primary: ['calves'], secondary: [],
    met: 3.5, increment: 10, repRange: [10, 20],
  }),
  E('cable-crunch', 'Cable Crunch', 'weight_reps', {
    aliases: ['cable crunch', 'cable crunches', 'kneeling crunch'],
    equipment: 'cable', primary: ['core'], secondary: [],
    met: 3.5, increment: 10, repRange: [10, 20],
  }),

  // ---- Bodyweight ----------------------------------------------------
  E('pull-up', 'Pull-Up', 'bodyweight_reps', {
    aliases: ['pull up', 'pull ups', 'pullup', 'pullups', 'chin up', 'chin ups', 'chinup', 'chinups'],
    equipment: 'bodyweight', primary: ['lats', 'back'], secondary: ['biceps'],
    met: 6, increment: 5, repRange: [5, 10], compound: true,
  }),
  E('push-up', 'Push-Up', 'bodyweight_reps', {
    aliases: ['push up', 'push ups', 'pushup', 'pushups', 'press up', 'press ups'],
    equipment: 'bodyweight', primary: ['chest'], secondary: ['triceps', 'shoulders'],
    met: 5, increment: 5, repRange: [10, 25], compound: true,
  }),
  E('dip', 'Dip', 'bodyweight_reps', {
    aliases: ['dip', 'dips', 'tricep dip', 'parallel bar dip'],
    equipment: 'bodyweight', primary: ['chest', 'triceps'], secondary: ['shoulders'],
    met: 6, increment: 5, repRange: [6, 12], compound: true,
  }),
  E('inverted-row', 'Inverted Row', 'bodyweight_reps', {
    aliases: ['inverted row', 'inverted rows', 'body row', 'australian pull up'],
    equipment: 'bodyweight', primary: ['back'], secondary: ['biceps'],
    met: 5, increment: 5, repRange: [8, 15], compound: true,
  }),
  E('hanging-leg-raise', 'Hanging Leg Raise', 'bodyweight_reps', {
    aliases: ['hanging leg raise', 'leg raise', 'leg raises', 'hanging knee raise', 'knee raise'],
    equipment: 'bodyweight', primary: ['core'], secondary: ['forearms'],
    met: 4, increment: 5, repRange: [8, 15],
  }),
  E('sit-up', 'Sit-Up', 'bodyweight_reps', {
    aliases: ['sit up', 'sit ups', 'situp', 'situps', 'crunch', 'crunches'],
    equipment: 'bodyweight', primary: ['core'], secondary: [],
    met: 4, increment: 5, repRange: [15, 30],
  }),
  E('burpee', 'Burpee', 'bodyweight_reps', {
    aliases: ['burpee', 'burpees'],
    equipment: 'bodyweight', primary: ['cardio'], secondary: ['chest', 'quads'],
    met: 8, increment: 5, repRange: [10, 20], compound: true,
  }),
  E('air-squat', 'Air Squat', 'bodyweight_reps', {
    aliases: ['air squat', 'air squats', 'bodyweight squat', 'bodyweight squats'],
    equipment: 'bodyweight', primary: ['quads', 'glutes'], secondary: [],
    met: 5, increment: 5, repRange: [15, 30], compound: true,
  }),

  // ---- Timed ---------------------------------------------------------
  E('plank', 'Plank', 'duration', {
    aliases: ['plank', 'planks', 'front plank', 'forearm plank'],
    equipment: 'bodyweight', primary: ['core'], secondary: [],
    met: 3.5, repRange: [30, 90],
  }),
  E('side-plank', 'Side Plank', 'duration', {
    aliases: ['side plank', 'side planks'],
    equipment: 'bodyweight', primary: ['core'], secondary: [],
    met: 3.5, repRange: [30, 60],
  }),
  E('dead-hang', 'Dead Hang', 'duration', {
    aliases: ['dead hang', 'dead hangs', 'bar hang', 'hang'],
    equipment: 'bodyweight', primary: ['forearms'], secondary: ['lats'],
    met: 3.5, repRange: [30, 60],
  }),
  E('farmers-carry', "Farmer's Carry", 'duration', {
    aliases: ['farmers carry', 'farmer carry', 'farmers walk', 'farmer walk', 'loaded carry'],
    equipment: 'dumbbell', primary: ['forearms', 'traps'], secondary: ['core'],
    met: 6, repRange: [30, 60], perSide: true,
  }),
  E('wall-sit', 'Wall Sit', 'duration', {
    aliases: ['wall sit', 'wall sits'],
    equipment: 'bodyweight', primary: ['quads'], secondary: [],
    met: 4, repRange: [30, 90],
  }),
  E('jump-rope', 'Jump Rope', 'duration', {
    aliases: ['jump rope', 'skipping', 'skip rope', 'jump ropes'],
    equipment: 'other', primary: ['cardio'], secondary: ['calves'],
    met: 12.3, repRange: [60, 300],
  }),

  // ---- Cardio (distance + duration) ---------------------------------
  E('run', 'Run', 'distance_duration', {
    aliases: ['run', 'running', 'ran', 'jog', 'jogging', 'treadmill run', 'treadmill'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['quads', 'calves'],
    met: 9.8,
  }),
  E('walk', 'Walk', 'distance_duration', {
    aliases: ['walk', 'walking', 'walked', 'incline walk', 'ruck'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['calves'],
    met: 3.8,
  }),
  E('bike', 'Bike', 'distance_duration', {
    aliases: ['bike', 'biking', 'cycling', 'cycle', 'stationary bike', 'spin', 'assault bike', 'air bike'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['quads'],
    met: 8,
  }),
  E('row-erg', 'Rowing Machine', 'distance_duration', {
    aliases: ['row erg', 'rowing machine', 'erg', 'rower', 'rowing', 'concept 2', 'concept two'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['back', 'quads'],
    met: 7,
  }),
  E('elliptical', 'Elliptical', 'distance_duration', {
    aliases: ['elliptical', 'cross trainer'],
    equipment: 'cardio', primary: ['cardio'], secondary: [],
    met: 5,
  }),
  E('stair-climber', 'Stair Climber', 'distance_duration', {
    aliases: ['stair climber', 'stairmaster', 'stair master', 'stairs'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['glutes', 'calves'],
    met: 9,
  }),
  E('swim', 'Swim', 'distance_duration', {
    aliases: ['swim', 'swimming', 'swam', 'laps'],
    equipment: 'cardio', primary: ['cardio'], secondary: ['back', 'shoulders'],
    met: 8.3,
  }),
];

export const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id) {
  return BY_ID.get(id) || null;
}

/** Every (alias, exercise) pair, longest alias first so "incline bench" wins over "bench". */
export const ALIAS_INDEX = (() => {
  const rows = [];
  for (const ex of EXERCISES) {
    const names = new Set([ex.name.toLowerCase(), ...ex.aliases]);
    for (const alias of names) {
      rows.push({ alias: alias.replace(/[-]/g, ' ').toLowerCase(), ex });
    }
  }
  rows.sort((a, b) => b.alias.length - a.alias.length);
  return rows;
})();
