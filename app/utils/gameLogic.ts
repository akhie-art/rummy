import { Suit, CardValue } from "../components/PlayingCard";

export interface Card {
  id: string;
  suit: Suit;
  value: CardValue;
  thrownBy?: string; // Attribution tracker for discard pile sequence
}

const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
const VALUES: CardValue[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// Create a full deck of 52 cards + 4 Jokers = 56 cards
export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  let idCounter = 0;
  
  // Standard 52 cards
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({
        id: `card_${idCounter++}`,
        suit,
        value,
      });
    }
  }

  // Add 4 Joker Cards
  for (let j = 0; j < 4; j++) {
    deck.push({
      id: `card_joker_${j}`,
      suit: "joker",
      value: "JKR",
    });
  }
  
  return deck;
};

// Fisher-Yates Shuffle Algorithm
export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Convert card value to numeric sorting order
export const getCardNumericValue = (value: CardValue): number => {
  switch (value) {
    case "A": return 1;
    case "2": return 2;
    case "3": return 3;
    case "4": return 4;
    case "5": return 5;
    case "6": return 6;
    case "7": return 7;
    case "8": return 8;
    case "9": return 9;
    case "10": return 10;
    case "J": return 11;
    case "Q": return 12;
    case "K": return 13;
    case "JKR": return 0; // Joker numeric baseline
    default: return 0;
  }
};

// Smart Point Calculator for Indonesian Remi scoring rules:
// 1. Numeric cards (2-10) = 5 points
// 2. Royal cards (J, Q, K) = 10 points
// 3. Ace (As) = 15 points
// 4. Joker (Wildcard) = 20 points (standard penalty high-tier value)
export const getCardPoints = (card: Card): number => {
  if (card.value === "A") return 15;
  if (card.value === "JKR" || card.suit === "joker") return 20; // fallback standalone value
  
  const numVal = getCardNumericValue(card.value);
  if (numVal >= 2 && numVal <= 10) return 5;
  if (numVal >= 11 && numVal <= 13) return 10;
  
  return 0;
};

// ── JOKER CONTEXTUAL POINTS ──────────────────────────────────────────────────
// Returns Joker point value based on what card it replaces inside a meld group.
// Rules:
//   - Joker as number card (2–10)  → 5 points
//   - Joker as face card (J, Q, K) → 10 points
//   - Joker as Ace (As)            → 15 points
export const getJokerContextPoints = (group: Card[]): number => {
  const nonJokers = group.filter(c => c.suit !== "joker" && c.value !== "JKR");
  if (nonJokers.length === 0) return 5; // all-joker edge case

  // ── SET: all non-jokers have same value ──
  const firstValue = nonJokers[0].value;
  const isAllSameValue = nonJokers.every(c => c.value === firstValue);
  if (isAllSameValue) {
    // Joker fills the same slot as the repeated value
    if (firstValue === "A") return 15;
    const n = getCardNumericValue(firstValue);
    if (n >= 11 && n <= 13) return 10;
    return 5;
  }

  // ── RUN: sequential values ──
  // Determine if the non-joker cards belong to the numeric group (2–10) or royal group (J,Q,K)
  const numericValues = nonJokers.map(c => getCardNumericValue(c.value));
  const isAllNumeric = numericValues.every(v => v >= 2 && v <= 10);
  const isAllRoyal   = numericValues.every(v => v >= 11 && v <= 13);

  if (isAllNumeric) {
    // Find the missing slot in the sorted sequence
    numericValues.sort((a, b) => a - b);
    const jokerCount = group.length - nonJokers.length;
    // Build expected sequence starting from min
    const allExpected: number[] = [];
    for (let i = numericValues[0]; allExpected.length < group.length; i++) {
      allExpected.push(i);
    }
    const missingVals = allExpected.filter(v => !numericValues.includes(v));
    // The missing value(s) are what the joker(s) replace — they're all in 2–10 range
    const replacedVal = missingVals[0] ?? numericValues[0];
    if (replacedVal >= 2 && replacedVal <= 10) return 5;
    if (replacedVal >= 11 && replacedVal <= 13) return 10;
    return 5;
  }

  if (isAllRoyal) return 10; // Joker fills J, Q, or K slot → 10

  // Mixed / edge case fallback
  return 5;
};

// ── MELD TOTAL POINTS (context-aware Joker) ───────────────────────────────────
// Use this instead of summing getCardPoints() for meld groups,
// so Joker gets the correct contextual value instead of the flat 20-pt penalty.
export const getMeldPoints = (group: Card[]): number => {
  const jokerPoints = getJokerContextPoints(group);
  return group.reduce((sum, card) => {
    if (card.suit === "joker" || card.value === "JKR") {
      return sum + jokerPoints;
    }
    return sum + getCardPoints(card);
  }, 0);
};



// Sort a player's hand by Suit first, then Value
export const sortHand = (hand: Card[]): Card[] => {
  return [...hand].sort((a, b) => {
    // First sort by suit
    if (a.suit !== b.suit) {
      return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    }
    // Then sort by numeric value
    return getCardNumericValue(a.value) - getCardNumericValue(b.value);
  });
};

// Check if a group of cards is a valid Set (same value, different suits)
// SUPPORTS JOKER WILDCARDS
export const isSet = (cards: Card[]): boolean => {
  if (cards.length < 3 || cards.length > 4) return false;
  
  const normalCards = cards.filter(c => c.suit !== "joker");
  
  // 100% Jokers is technically a valid set
  if (normalCards.length === 0) return true;
  
  // Must all have the exact same value
  const value = normalCards[0].value;
  const allSameValue = normalCards.every(c => c.value === value);
  if (!allSameValue) return false;
  
  // Must have unique suits among non-joker cards
  const suits = new Set(normalCards.map(c => c.suit));
  return suits.size === normalCards.length;
};

// Check if a group of cards is a valid Run (same suit, sequential values)
// RULES & JOKER UPDATE: 
// 1. Only sequential cards from 2 to 10 are allowed (e.g., 8-9-10).
// 2. Face cards (J, Q, K) can only form sequence J-Q-K.
// 3. CROSSOVER (9-10-J) is strictly FORBIDDEN.
// 4. Ace (As) cannot be part of ANY run/sequence (No A-2-3, No Q-K-A).
// 5. Jokers can represent any gap/value.
export const isRun = (cards: Card[]): boolean => {
  if (cards.length < 3) return false;
  
  const normalCards = cards.filter(c => c.suit !== "joker");
  
  // 100% Jokers is technically a valid run
  if (normalCards.length === 0) return true;
  
  // Ace (value "A") is strictly NOT allowed in any run
  if (normalCards.some(c => c.value === "A")) return false;
  
  // All normal cards must share the SAME suit
  const baseSuit = normalCards[0].suit;
  const allSameSuit = normalCards.every(c => c.suit === baseSuit);
  if (!allSameSuit) return false;

  const values = normalCards.map(c => getCardNumericValue(c.value));
  const isAllNumericGroup = values.every(v => v >= 2 && v <= 10);
  const isAllRoyalGroup = values.every(v => v >= 11 && v <= 13);

  // Crossovers like 9-10-J are invalid
  if (!isAllNumericGroup && !isAllRoyalGroup) return false;
  
  // Royal sequence max size is 3 (J,Q,K)
  if (isAllRoyalGroup && cards.length > 3) return false;

  // Cannot repeat values in a run (e.g. [4H, 4H, Joker] is not a run)
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== normalCards.length) return false;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const L = cards.length;

  // The distance between min and max must fit within length L
  if (maxVal - minVal > L - 1) return false;

  // Boundaries Check: Verify there is a valid sequence interval within bounds
  // that encompasses the existing normal cards.
  const boundMin = isAllNumericGroup ? 2 : 11;
  const boundMax = isAllNumericGroup ? 10 : 13;
  
  let hasValidConfiguration = false;
  for (let S = boundMin; S <= boundMax - L + 1; S++) {
    const endVal = S + L - 1;
    // If this candidate range [S, endVal] encompasses the actual cards, it's valid!
    if (S <= minVal && endVal >= maxVal) {
      hasValidConfiguration = true;
      break;
    }
  }

  return hasValidConfiguration;
};

export const hasAnyExistingRun = (cards: Card[]): boolean => {
  if (cards.length < 3) return false;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        if (isRun([cards[i], cards[j], cards[k]])) {
          return true;
        }
      }
    }
  }
  return false;
};

// Smart Validator: Checks if a specific card can form a 3-card combination (Set or Run) 
// with cards that are already present in the player's hand.
// Uses O(N^2) hand pair analysis to seamlessly support Jokers, boundaries, 
// and enforces the strict No-Middle-Catch condition.
export const canDrawDiscardCard = (targetCard: Card, hand: Card[]): boolean => {
  return getAutomaticDiscardMeldCards(targetCard, hand) !== null;
};

// Helper to find which cards in hand actually form the meld with a drawn discard
export const getAutomaticDiscardMeldCards = (targetCard: Card, hand: Card[]): Card[] | null => {
  if (hand.length < 2) return null;

  // We sort the hand first to make the selection predictable (preferring neighbors)
  const sortedHand = sortHand(hand);

  for (let i = 0; i < sortedHand.length; i++) {
    for (let j = i + 1; j < sortedHand.length; j++) {
      const c1 = sortedHand[i];
      const c2 = sortedHand[j];
      
      // 1. CHECK SET (MUST HAVE EXISTING RUN)
      if (isSet([c1, c2, targetCard])) {
        const remainingHand = sortedHand.filter(c => c.id !== c1.id && c.id !== c2.id);
        if (hasAnyExistingRun(remainingHand)) {
          return [c1, c2];
        }
      }
      
      // 2. CHECK RUN
      if (isRun([c1, c2, targetCard])) {
        if (targetCard.suit === "joker") return [c1, c2];

        const T = getCardNumericValue(targetCard.value);
        const normalValues = [c1, c2, targetCard]
          .filter(c => c.suit !== "joker")
          .map(c => getCardNumericValue(c.value));
        
        const minVal = Math.min(...normalValues);
        const maxVal = Math.max(...normalValues);
        const isAllNumeric = normalValues.every(v => v >= 2 && v <= 10);
        const boundMin = isAllNumeric ? 2 : 11;
        const boundMax = isAllNumeric ? 10 : 13;

        for (let S = boundMin; S <= boundMax - 2; S++) {
          const endVal = S + 2;
          if (S <= minVal && endVal >= maxVal) {
            if (T === S || T === endVal) {
              return [c1, c2];
            }
          }
        }
      }
    }
  }
  return null;
};

