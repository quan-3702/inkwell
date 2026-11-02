// Inkwell – writing prompts and templates.
'use strict';
const PROMPTS = [
  'What made you smile today?', 'Three things you are grateful for right now.', 'What is on your mind that you have not said out loud?',
  'Describe today in five words, then explain them.', 'What did you learn today – about the world or about yourself?', 'Who did you talk to today, and how did it feel?',
  'What is one small win from this week?', 'What would make tomorrow a good day?', 'What are you worried about? What can you actually control?',
  'Describe a place where you feel completely calm.', 'What is a memory you want to keep forever?', 'What did your body need today? Did it get it?',
  'Write a letter to yourself one year from now.', 'Write a letter to your younger self.', 'What are you looking forward to?',
  'What drained your energy today? What gave you energy?', 'If today were a chapter in a book, what would its title be?', 'What is something you are proud of, even if nobody noticed?',
  'What habit do you want to start – or stop?', 'Describe a meal you enjoyed recently.', 'What song matches your mood today, and why?',
  'What would you do this weekend if nothing could go wrong?', 'Who are you thankful for, and have you told them?', 'What is a mistake that taught you something?',
  'What does a perfect ordinary day look like for you?', 'What are you avoiding? What is the first tiny step?', 'Write about a conversation that stayed with you.',
  'What made you laugh recently?', 'What do you need to forgive – in someone else or in yourself?', 'List 10 things that make you happy, as fast as you can.',
  'How did you take care of yourself today?', 'What surprised you this week?', 'What is a goal for this month, and why does it matter?',
  'Describe the view from your window right now.', 'What advice would you give a friend in your situation?', 'What are three words you want to describe your year?',
  'What is something new you tried recently?', 'When did you feel most like yourself today?', 'What would you like to remember about this season of life?',
  'Write about someone who changed your life.', 'What are you curious about lately?', 'What is weighing on you? Write it down and set it aside.',
  'Describe a dream you had – or a dream you have for the future.', 'What did you do today that your future self will thank you for?', 'What made today different from yesterday?',
  'What is a small luxury you enjoy?', 'Where do you want to travel, and what would you do there?', 'What boundaries do you need to set?',
  'Write down a compliment you received and how it felt.', 'What is the best thing that happened this month?', 'What are you still learning to accept?',
  'Describe your morning in detail.', 'What does “home” mean to you?', 'What would you tell someone who is having a day like yours?',
  'Which book, film or show has been on your mind?', 'What do you want more of in your life? Less of?', 'Tonight, before sleep: what are you letting go of?',
];
const TEMPLATES = [
  { name: '🌅 Five-minute morning', body: '## I am grateful for\n- \n- \n- \n\n## What would make today great\n- \n- \n\n## Today I am…\n' },
  { name: '🌙 Evening reflection', body: '## Three good things today\n1. \n2. \n3. \n\n## How could today have been better?\n\n## Tomorrow I will…\n' },
  { name: '🙏 Gratitude', body: '## Today I am thankful for\n1. \n2. \n3. \n4. \n5. \n\n## Someone I appreciate and why\n' },
  { name: '✈️ Travel day', body: '## Where I am\n\n## What I saw\n\n## What I ate\n\n## Best moment\n\n## People I met\n' },
  { name: '💭 Dream log', body: '## The dream\n\n## How it felt\n\n## People and places\n\n## What it might mean\n' },
  { name: '🎯 Weekly review', body: '## Wins this week\n- \n\n## What I learned\n- \n\n## What I will change next week\n- \n\n## Focus for next week\n' },
  { name: '😟 Worry dump', body: '## What is worrying me\n\n## What I can control\n\n## What I cannot control\n\n## One next step\n' },
  { name: '📚 Reading notes', body: '## Book\n\n## Favourite quote\n> \n\n## What I think about it\n' },
];
