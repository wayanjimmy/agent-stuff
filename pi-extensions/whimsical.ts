/**
 * Whimsical Working Messages Extension
 *
 * Replaces the default "Working..." message with random fun phrases
 * on each turn. Inspired by mitsuhiko's whimsical extension,
 * gemini-cli's witty loading phrases, and Claude Code's spinner verbs.
 *
 * Usage:
 *   pi -e pi-extensions/whimsical.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const messages = [
  // Vibes (the best single-word verbs)
  "Vibing...",
  "Noodling...",
  "Percolating...",
  "Marinating...",
  "Brewing...",
  "Contemplating...",
  "Meandering...",
  "Moseying...",
  "Discombobulating...",
  "Recombobulating...",
  "Pirouetting...",
  "Frolicking...",
  "Galumphing...",
  "Wibbling...",
  "Spelunking...",
  "Simmering...",
  "Cogitating...",
  "Pontificating...",
  "Transmuting...",
  "Ruminating...",
  "Fermenting...",
  "Effervescing...",
  "Scintillating...",
  "Improvising...",
  "Manifesting...",
  "Pondering...",
  "Mulling...",
  "Musing...",
  "Perambulating...",
  "Nesting...",
  "Incubating...",
  "Germinating...",
  "Propagating...",
  "Synthesizing...",
  "Cultivating...",
  "Coalescing...",
  "Crystallizing...",
  "Sublimating...",
  "Unfurling...",
  "Unravelling...",
  "Wrangling...",
  "Tinkering...",
  "Grooving...",
  "Boogieing...",
  "Moonwalking...",
  "Gallivanting...",
  "Lollygagging...",
  "Tomfoolering...",
  "Hullaballooing...",
  "Skedaddling...",
  "Schlepping...",
  "Canoodling...",
  "Boondoggling...",
  "Flibbertigibbeting...",
  "Clauding...",
  "Dilly-dallying...",
  "Fiddle-faddling...",
  "Bamboozling...",
  "Flummoxing...",
  "Finagling...",
  "Befuddling...",
  "Bloviating...",
  "Shenaniganing...",

  // Programmer humor
  "Reticulating splines...",
  "Bribing the compiler...",
  "Consulting the rubber duck...",
  "Herding pointers...",
  "Untangling spaghetti...",
  "Polishing the algorithms...",
  "Appeasing the garbage collector...",
  "Summoning semicolons...",
  "Converting coffee into code...",
  "Looking for a misplaced semicolon...",
  "Trying to exit Vim...",
  "Rewriting in Rust for no particular reason...",
  "Resolving dependencies… and existential crises...",
  "Searching for the correct USB orientation...",
  "Dividing by zero… just kidding!",
  "Constructing additional pylons...",
  "That's not a bug, it's an undocumented feature...",
  "Gitifying...",
  "Git commit -m 'fix stuff'...",
  "Waiting for webpack...",
  "npm install (please don't break)...",
  "It works on my machine...",

  // Pop culture
  "Calibrating the flux capacitor...",
  "Engaging the improbability drive...",
  "Channeling the Force...",
  "Don't panic...",
  "Following the white rabbit...",
  "Finishing the Kessel Run in less than 12 parsecs...",
  "The cake is not a lie, it's just still loading...",
  "So say we all...",
  "I'll be back… with an answer.",
  "Engage.",
  "Blowing on the cartridge...",
  "Loading… Do a barrel roll!",
  "Communing with the machine spirit...",
  "Houston, we have a solution...",
  "Warp speed engaged...",
  "Activating Ludicrous Speed...",
  "Han shot first...",
  "Winter is coming...",
  "You shall not parse!",

  // Cooking metaphors
  "Sautéing the syntax errors...",
  "Caramelizing the callbacks...",
  "Flambéing the failures...",
  "Seasoning the solutions...",
  "Baking at 350 kilobytes...",
  "Frosting the functions...",
  "Letting the dough rise...",
  "Barbecuing the bugs...",
  "Roasting the race conditions...",
  "Julienning the JSON...",
  "Kneading the nodes...",
  "Proofing the protocol...",

  // Whimsical
  "Consulting the digital spirits...",
  "Shaking the magic 8-ball...",
  "Reading tea leaves...",
  "Warming up the hamsters...",
  "Staring into the abyss...",
  "Abyss staring back...",
  "Achieving enlightenment...",
  "Manifesting solutions...",
  "Willing it into existence...",
  "Believing really hard...",
  "Politely asking the CPU...",
  "Sweet-talking the API...",
  "Having a little think...",
  "Stroking chin thoughtfully...",
  "Squinting at the problem...",
  "Pondering the orb...",
  "Sprinkling some magic dust...",
  "Hoping for the best...",
  "Almost there… probably...",
  "Distracting you with this witty phrase...",
  "Buffering… because even AIs need a moment.",
  "Giving the code a pep talk...",
  "Dusting off the neurons...",
  "Watering the logic tree...",
  "Herding digital cats...",
  "Wishing upon a star...",
  "Searching for meaning...",
  "Calculating the meaning of life... (it's 42)",
  "Thinking really hard...",
];

function pickRandom(): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(pickRandom());
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctx.ui.setWorkingMessage();
  });
}
