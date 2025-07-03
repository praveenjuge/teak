import { db } from '../db';
import { cards, users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Sample card data for different types
const sampleCards = [
  // Audio cards
  {
    type: 'audio' as const,
    data: {
      transcription: 'This is a podcast episode about artificial intelligence and machine learning trends in 2024. We discuss the latest developments in neural networks, transformer models, and their applications in various industries.',
      media_url: 'https://example.com/ai-podcast-episode-1.mp3',
      duration: 1800,
      title: 'AI Trends 2024: Machine Learning Revolution'
    },
    metaInfo: {
      language: 'en',
      playtime: '00:30:00',
      file_size: 45000000,
      source: 'Tech Podcast',
      tags: ['AI', 'machine learning', 'technology', 'podcast']
    }
  },
  {
    type: 'audio' as const,
    data: {
      transcription: 'Interview with startup founder discussing the challenges of building a SaaS company from scratch. Topics include product-market fit, customer acquisition, and scaling challenges.',
      media_url: 'https://example.com/startup-interview.mp3',
      duration: 2400,
      title: 'From Zero to SaaS: A Founder\'s Journey'
    },
    metaInfo: {
      language: 'en',
      playtime: '00:40:00',
      source: 'Entrepreneur Radio',
      tags: ['startup', 'SaaS', 'entrepreneurship', 'business']
    }
  },

  // Text cards
  {
    type: 'text' as const,
    data: {
      content: 'React 19 introduces several new features including concurrent features, automatic batching, and improved server-side rendering. The new useTransition hook allows for better user experience by marking updates as non-urgent.',
      title: 'React 19 New Features Summary'
    },
    metaInfo: {
      source: 'React Documentation',
      tags: ['React', 'frontend', 'JavaScript', 'web development'],
      created_by: 'React Team'
    }
  },
  {
    type: 'text' as const,
    data: {
      content: 'The principles of clean code include: meaningful names, small functions, clear comments, consistent formatting, and avoiding duplication. Code should read like well-written prose.',
      title: 'Clean Code Principles'
    },
    metaInfo: {
      source: 'Clean Code Book',
      tags: ['clean code', 'software engineering', 'best practices'],
      created_by: 'Robert C. Martin'
    }
  },

  // URL cards
  {
    type: 'url' as const,
    data: {
      url: 'https://github.com/microsoft/TypeScript',
      title: 'TypeScript Official Repository',
      description: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output. It adds optional static type definitions to JavaScript.'
    },
    metaInfo: {
      source: 'GitHub',
      tags: ['TypeScript', 'JavaScript', 'programming', 'open source']
    }
  },
  {
    type: 'url' as const,
    data: {
      url: 'https://nextjs.org/docs',
      title: 'Next.js Documentation',
      description: 'Learn about Next.js features and API. Next.js gives you the best developer experience with all the features you need for production.'
    },
    metaInfo: {
      source: 'Next.js',
      tags: ['Next.js', 'React', 'frontend', 'documentation']
    }
  },

  // Image cards
  {
    type: 'image' as const,
    data: {
      media_url: 'https://picsum.photos/800/600?random=1',
      alt_text: 'Database architecture diagram showing microservices communication',
      title: 'Microservices Database Architecture',
      description: 'A comprehensive diagram illustrating how different microservices communicate with their respective databases in a distributed system.'
    },
    metaInfo: {
      source: 'Architecture Documentation',
      tags: ['microservices', 'database', 'architecture', 'diagram'],
      file_size: 1200000
    }
  },
  {
    type: 'image' as const,
    data: {
      media_url: 'https://picsum.photos/800/600?random=2',
      alt_text: 'Code review checklist infographic',
      title: 'Code Review Best Practices',
      description: 'Visual guide showing the essential steps and considerations for conducting effective code reviews.'
    },
    metaInfo: {
      source: 'Development Guidelines',
      tags: ['code review', 'best practices', 'development', 'infographic']
    }
  },

  // Video cards
  {
    type: 'video' as const,
    data: {
      media_url: 'https://example.com/docker-tutorial.mp4',
      transcription: 'Welcome to Docker basics. In this tutorial, we will learn how to containerize applications, create Docker images, and manage containers using Docker Compose.',
      duration: 3600,
      title: 'Docker Fundamentals Tutorial'
    },
    metaInfo: {
      language: 'en',
      playtime: '01:00:00',
      source: 'DevOps Academy',
      tags: ['Docker', 'containers', 'DevOps', 'tutorial'],
      file_size: 150000000
    }
  },
  {
    type: 'video' as const,
    data: {
      media_url: 'https://example.com/api-design.mp4',
      transcription: 'This video covers REST API design principles, including proper use of HTTP methods, status codes, and API versioning strategies. We also discuss GraphQL as an alternative approach.',
      duration: 2700,
      title: 'API Design Best Practices'
    },
    metaInfo: {
      language: 'en',
      playtime: '00:45:00',
      source: 'API Academy',
      tags: ['API', 'REST', 'GraphQL', 'web development']
    }
  },

  // Additional diverse content
  {
    type: 'text' as const,
    data: {
      content: 'PostgreSQL is a powerful, open source object-relational database system with over 30 years of active development. It has a strong reputation for reliability, feature robustness, and performance.',
      title: 'PostgreSQL Overview'
    },
    metaInfo: {
      source: 'PostgreSQL Documentation',
      tags: ['PostgreSQL', 'database', 'SQL', 'open source']
    }
  },
  {
    type: 'audio' as const,
    data: {
      transcription: 'Deep dive into database optimization techniques including indexing strategies, query optimization, and connection pooling. Learn how to identify and resolve performance bottlenecks.',
      media_url: 'https://example.com/db-optimization.mp3',
      duration: 2100,
      title: 'Database Performance Optimization'
    },
    metaInfo: {
      language: 'en',
      playtime: '00:35:00',
      source: 'Database Masterclass',
      tags: ['database', 'optimization', 'performance', 'indexing']
    }
  },
  {
    type: 'url' as const,
    data: {
      url: 'https://tailwindcss.com/docs',
      title: 'Tailwind CSS Documentation',
      description: 'A utility-first CSS framework packed with classes that can be composed to build any design, directly in your markup.'
    },
    metaInfo: {
      source: 'Tailwind CSS',
      tags: ['CSS', 'styling', 'frontend', 'utility-first']
    }
  }
];

export async function seedCards() {
  try {
    console.log('🌱 Starting card seeding...');

    // Get the first user to associate cards with
    const [user] = await db.select().from(users).limit(1);
    
    if (!user) {
      console.log('❌ No users found. Please create a user first before seeding cards.');
      return;
    }

    console.log(`📝 Found user: ${user.email} (${user.id})`);

    // Check if cards already exist for this user
    const existingCards = await db
      .select()
      .from(cards)
      .where(eq(cards.userId, user.id))
      .limit(1);

    if (existingCards.length > 0) {
      console.log('⚠️  Cards already exist for this user. Skipping seeding.');
      return;
    }

    // Insert sample cards
    const cardsToInsert = sampleCards.map(card => ({
      ...card,
      userId: user.id
    }));

    const insertedCards = await db
      .insert(cards)
      .values(cardsToInsert)
      .returning();

    console.log(`✅ Successfully seeded ${insertedCards.length} cards:`);
    
    // Show summary by type
    const cardsByType = insertedCards.reduce((acc, card) => {
      acc[card.type] = (acc[card.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(cardsByType).forEach(([type, count]) => {
      console.log(`   📋 ${type}: ${count} cards`);
    });

    console.log('🎉 Card seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding cards:', error);
    throw error;
  }
}

// Allow running this script directly
if (import.meta.main) {
  await seedCards();
  process.exit(0);
}