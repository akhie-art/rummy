import { Suit, CardValue } from "../components/PlayingCard";

export interface Card {
  id: string;
  suit: Suit;
  value: CardValue;
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
  if (card.value === "JKR" || card.suit === "joker") return 20;
  
  const numVal = getCardNumericValue(card.value);
  if (numVal >= 2 && numVal <= 10) return 5;
  if (numVal >= 11 && numVal <= 13) return 10;
  
  return 0;
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

// Smart Validator: Checks if a specific card can form a 3-card combination (Set or Run) 
// with cards that are already present in the player's hand.
// Uses O(N^2) hand pair analysis to seamlessly support Jokers, boundaries, 
// and enforces the strict No-Middle-Catch condition.
export const canDrawDiscardCard = (targetCard: Card, hand: Card[]): boolean => {
  if (hand.length < 2) return false;

  // Iterate through every unique pair in hand to see if they form a valid meld with targetCard
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const c1 = hand[i];
      const c2 = hand[j];
      
      // 1. CHECK SET (KARTU SAMA) WITH THIS PAIR
      if (isSet([c1, c2, targetCard])) {
        return true;
      }
      
      // 2. CHECK RUN (URUTAN SERI) WITH THIS PAIR
      if (isRun([c1, c2, targetCard])) {
        
        // If target is Joker itself, it can represent anything, thus it's an allowed draw!
        if (targetCard.suit === "joker") {
          return true;
        }

        // Enforce strict "No Middle Catch":
        // Target card must be physically able to represent either end of a valid 3-card sequence
        const T = getCardNumericValue(targetCard.value);
        const normalValues = [c1, c2, targetCard]
          .filter(c => c.suit !== "joker")
          .map(c => getCardNumericValue(c.value));
        
        const minVal = Math.min(...normalValues);
        const maxVal = Math.max(...normalValues);
        const isAllNumeric = normalValues.every(v => v >= 2 && v <= 10);
        
        const boundMin = isAllNumeric ? 2 : 11;
        const boundMax = isAllNumeric ? 10 : 13;

        // Check valid sequence intervals [S, S+1, S+2]
        for (let S = boundMin; S <= boundMax - 2; S++) {
          const endVal = S + 2;
          
          // If this configuration covers our cards
          if (S <= minVal && endVal >= maxVal) {
            // Target card MUST occupy either the START or the END of this 3-card Run
            if (T === S || T === endVal) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
};

