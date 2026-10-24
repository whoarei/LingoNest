import type { MaterialInput } from "../learning-modes/catalog";

/** Shared textbook source; contains no teaching rules. */
export const starterMaterial = {
  id: "starter.unit1.lesson1",
  title: "一起加入运动队",
  subtitle: "Unit 1 · Lesson 1",
  sourceText: "Wang Tao: Look. We need new players for our basketball team. Who will join us?\nChen Hai: I will. I like playing basketball.\nWang Tao: Are you good at it?\nChen Hai: Yes, I am. I often play basketball after school.\nWang Tao: Great!\nYang Ming: Hi, Ma Li! Will you join the football team?\nMa Li: No, I won't. I'm not good at playing football.\nYang Ming: What's your favorite sport?\nMa Li: My favorite sport is ping-pong.\nYang Ming: The ping-pong team is over there. You can go and have a look.\nMa Li: Thank you very much.\nMa Li: Is this the ping-pong team?\nXia Yiyi: Yes, it is. Will you join us?\nMa Li: Yes, I will. I want to learn more skills about playing ping-pong.\nXia Yiyi: Great! You'll be a good player.",
  images: ["1000075731.jpg", "1000075732.jpg", "1000075733.jpg"].map(path => ({ path: `/source/${path}`, rotation: 0 as const })),
  supplementImages: [],
} satisfies MaterialInput & { id: string };
