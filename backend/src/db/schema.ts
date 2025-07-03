import { pgTable, text, serial, pgEnum, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

// Users table for Better Auth
export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

// Sessions table for Better Auth
export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

// Accounts table for Better Auth (for OAuth providers)
export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

// Verification table for Better Auth
export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});


// Cards
// We can have the data part to have core attributes relevant to the card type
// and the meta_info part to have more non core attributes.

// e.g
// Audio
// {
//   "type": "audio",
//   "data": {
//     "transcription": "This audio talks about google search engine",
//     "media_url": "https://example.com/audio.mp3"
//   },
//   "meta_info": {
//     "language": "en",
//     "playtime": "00:10:00"
//   }
// }
// 
// Text
// {
//   "type": "text",
//   "data": {
//     "content": "This is a text card"
//    },
//   "meta_info": {}
// }

export const cardType = pgEnum('cardType', ['audio', 'text', 'url', 'image', 'video'])
export const cards = pgTable('cards', {
  id: serial('id').primaryKey().notNull(),
  type: cardType('type').notNull(),
  data: jsonb('data').default({}), // contains content, url, transcription, media_url based on type
  metaInfo: jsonb('metaInfo').default({}),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  deletedAt: timestamp('deletedAt'),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
})
