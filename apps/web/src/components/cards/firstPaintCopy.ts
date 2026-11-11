import { createContext } from "react";

/**
 * True inside the server-rendered stand-in grid. Its cards leave out their
 * card ids, so only the masonry copy answers to a card's id while both are on
 * the page: focus, keyboard moves and selectors always reach the live card.
 */
export const FirstPaintCopyContext = createContext(false);
