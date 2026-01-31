export interface Author {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatar: string;
  social: {
    twitter?: string;
    github?: string;
    website?: string;
  };
}

export const authors: Record<string, Author> = {
  praveenjuge: {
    id: "praveenjuge",
    name: "Praveen Juge",
    role: "Creator & Lead Developer",
    bio: "Designer and developer building tools for creative professionals. Previously worked on design systems and developer tools. Passionate about making inspiration management effortless.",
    avatar: "https://github.com/praveenjuge.png",
    social: {
      twitter: "https://x.com/praveenjuge",
      github: "https://github.com/praveenjuge",
      website: "https://praveenjuge.com",
    },
  },
};

export const getAuthor = (id: string): Author | undefined => authors[id];

export const getDefaultAuthor = (): Author => authors.praveenjuge;
