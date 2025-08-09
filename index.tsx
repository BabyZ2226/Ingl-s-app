import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { GoogleGenAI, Type, Chat } from "@google/genai";

// --- Type definitions ---
type Difficulty = 'A1' | 'B1' | 'C1';
type Theme = 'light' | 'dark';
type Persona = 'friendly' | 'formal';
type View = 'home' | 'story' | 'vocabulary' | 'translation' | 'pronunciation' | 'conversation' | 'writingAnalysis' | 'phrasalVerbs' | 'phrases' | 'dictionary' | 'exams';
type ExamType = 'comprehensive' | 'reading_vocab' | 'writing_grammar' | 'listening_speaking';
type ExamState = 'setup' | 'in-progress' | 'results';
type QuestionType = 'mcq' | 'writing' | 'speaking' | 'listening';

interface Settings {
  difficulty: Difficulty;
  theme: Theme;
  persona: Persona;
}

interface ExamSettings {
  type: ExamType;
  questions: 5 | 10 | 15;
}

interface ExamQuestion {
  id: number;
  type: QuestionType;
  text: string;
  options?: string[];
}

interface UserAnswer {
  questionId: number;
  answer: string;
}

interface ExamResult {
  overallScore: number;
  summary: string;
  feedback: {
    questionId: number;
    questionText: string;
    userAnswer: string;
    isCorrect: boolean;
    feedback: string;
  }[];
}

interface WordOfTheDay {
    word: string;
    definition: string;
    example: string;
}

// --- Constants ---
const difficultyLevels: Record<Difficulty, string> = { 'A1': 'Beginner', 'B1': 'Intermediate', 'C1': 'Advanced' };
const personaTypes: Record<Persona, string> = { 'friendly': 'Friendly Tutor', 'formal': 'Formal Examiner' };
const personaInstructions: Record<Persona, string> = {
  friendly: 'You are a friendly and encouraging English tutor. Your feedback is positive and gentle.',
  formal: 'You are a formal English examiner. Your feedback is precise, professional, and direct.',
};
const viewIcons: Record<View, string> = { home: 'home', story: 'auto_stories', vocabulary: 'school', translation: 'translate', pronunciation: 'record_voice_over', conversation: 'chat', writingAnalysis: 'edit_document', phrasalVerbs: 'dynamic_form', phrases: 'format_quote', dictionary: 'menu_book', exams: 'quiz' };
const viewNames: Record<View, string> = { home: 'Home', story: 'Story Practice', vocabulary: 'Vocabulary', translation: 'Translation', pronunciation: 'Speaking', conversation: 'AI Conversation', writingAnalysis: 'Writing Analysis', phrasalVerbs: 'Phrasal Verbs', phrases: 'Common Phrases', dictionary: 'Dictionary', exams: 'Exams' };


// --- Speech Recognition/Synthesis setup ---
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
}
const synth = window.speechSynthesis;


const App = () => {
  const [settings, setSettings] = useState<Settings>({ difficulty: 'A1', theme: 'light', persona: 'friendly' });
  const [activeView, setActiveView] = useState<View>('home');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // For secondary loaders
  const [wordOfTheDay, setWordOfTheDay] = useState<WordOfTheDay | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // --- Mode-specific state ---
  const [story, setStory] = useState({ text: '', question: '' });
  const [storyAnswer, setStoryAnswer] = useState('');
  const [storyFeedback, setStoryFeedback] = useState('');
  const [pronunciationPrompt, setPronunciationPrompt] = useState('');
  const [pronunciationFeedback, setPronunciationFeedback] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [dictionaryWord, setDictionaryWord] = useState('');
  const [dictionaryResult, setDictionaryResult] = useState<{ word: string; partOfSpeech: string; definition: string; example: string } | null>(null);
  const [vocabularyList, setVocabularyList] = useState<{ word: string; definition: string; example: string; }[]>([]);
  const [translationTask, setTranslationTask] = useState({ sentence: '', feedback: '' });
  const [userTranslation, setUserTranslation] = useState('');
  const [writingInput, setWritingInput] = useState('');
  const [writingFeedback, setWritingFeedback] = useState<{ overall: string; grammar: string; style: string; vocabulary: string; } | null>(null);
  const [phrasalVerb, setPhrasalVerb] = useState<{ verb: string; definition: string; example: string; } | null>(null);
  const [commonPhrase, setCommonPhrase] = useState<{ phrase: string; meaning: string; example: string; } | null>(null);


  // --- Exam State ---
  const [examState, setExamState] = useState<ExamState>('setup');
  const [examSettings, setExamSettings] = useState<ExamSettings>({ type: 'comprehensive', questions: 5 });
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [examResults, setExamResults] = useState<ExamResult | null>(null);

  // --- Refs ---
  const [popup, setPopup] = useState<{text: string; x: number; y: number, loading: boolean, original?: string}>({text: '', x: 0, y: 0, loading: false});
  const mainContentRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // --- Effects ---
  useEffect(() => {
    document.body.className = `${settings.theme}-theme`;
  }, [settings.theme]);

  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    generateWordOfTheDay();
  }, []);
  
  useEffect(() => {
    const handleMouseUp = async (event: MouseEvent) => {
      const popupEl = document.querySelector('.translation-popup');
      if (popupEl && !popupEl.contains(event.target as Node)) {
        setPopup({text: '', x: 0, y: 0, loading: false});
      }
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? '';
      
      if (selectedText.length > 0 && selectedText.length < 100 && mainContentRef.current?.contains(selection.anchorNode)) {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA') return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopup({ text: '', x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 5, loading: true, original: selectedText });
        
        try {
          const prompt = `Translate the following English text to Spanish: "${selectedText}"`;
          const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
          setPopup(p => ({ ...p, text: response.text, loading: false }));
        } catch (e) {
          console.error("Translation error", e);
          setPopup({text: 'Translation failed.', x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 5, loading: false});
        }
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // --- Handlers ---
  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const changeView = (view: View) => {
    setError(''); setActiveView(view);
    if (view !== 'exams') setExamState('setup');
    switch(view) {
        case 'story': generateStory(); break;
        case 'pronunciation': generatePronunciationPrompt(); break;
        case 'conversation': initializeChat(); break;
        case 'vocabulary': generateVocabulary(); break;
        case 'translation': generateTranslationTask(); break;
        case 'writingAnalysis': setWritingInput(''); setWritingFeedback(null); break;
        case 'phrasalVerbs': generatePhrasalVerb(); break;
        case 'phrases': generateCommonPhrase(); break;
        default: break;
    }
  };

  const generateContent = async (prompt: string, schema?: any, systemInstruction?: string) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: prompt,
        config: {
          ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
          ...(systemInstruction ? { systemInstruction } : {})
        },
      });
      return response;
    } catch (e) {
      console.error(e); setError('An error occurred. Please try again.');
      return null;
    }
  };

  // --- Core Function Implementations ---
  const generateWordOfTheDay = async () => {
    const schema = {type: Type.OBJECT, properties: { word: {type: Type.STRING}, definition: {type: Type.STRING}, example: {type: Type.STRING} }, required: ['word', 'definition', 'example']};
    const response = await generateContent("Generate an interesting English word of the day appropriate for an intermediate learner.", schema);
    if(response) setWordOfTheDay(JSON.parse(response.text));
  }

  const generateStory = async () => {
    setIsLoading(true); setStory({text: '', question: ''}); setStoryAnswer(''); setStoryFeedback('');
    const schema = {type: Type.OBJECT, properties: { story: {type: Type.STRING}, question: {type: Type.STRING}}, required: ['story', 'question']};
    const prompt = `Generate a short story (3-4 paragraphs) and a comprehension question about it for an English learner at the ${difficultyLevels[settings.difficulty]} level.`;
    const response = await generateContent(prompt, schema);
    if(response) {
      const data = JSON.parse(response.text);
      setStory({text: data.story, question: data.question});
    }
    setIsLoading(false);
  };

  const checkStoryAnswer = async (e: React.FormEvent) => {
    e.preventDefault(); if(!storyAnswer) return;
    setIsSubmitting(true); setStoryFeedback('');
    const prompt = `A ${difficultyLevels[settings.difficulty]} English learner was told the story: "${story.text}". They were asked: "${story.question}". Their answer was: "${storyAnswer}". Provide feedback on their comprehension and grammar.`;
    const response = await generateContent(prompt, undefined, personaInstructions[settings.persona]);
    if(response) setStoryFeedback(response.text);
    setIsSubmitting(false);
  };
  
  const generatePronunciationPrompt = async () => {
    setIsLoading(true); setPronunciationPrompt(''); setTranscript(''); setPronunciationFeedback('');
    const prompt = `Give me a single, interesting sentence to practice my pronunciation. The sentence should be appropriate for a ${difficultyLevels[settings.difficulty]} level learner. Just provide the sentence, no extra text.`;
    const response = await generateContent(prompt);
    if(response) setPronunciationPrompt(response.text);
    setIsLoading(false);
  }

  const handlePronunciation = () => {
      if (isRecording) {
          recognition.stop();
          setIsRecording(false);
      } else {
          setTranscript('');
          setPronunciationFeedback('');
          recognition.onresult = (e: any) => {
              const fullTranscript = Array.from(e.results).map((r: any) => r[0].transcript).join('');
              setTranscript(fullTranscript);
          };
          recognition.start();
          setIsRecording(true);
      }
  };

  const analyzeSpeech = async () => {
      if(!transcript) return;
      setIsSubmitting(true);
      const prompt = `A ${difficultyLevels[settings.difficulty]} learner was asked to say: "${pronunciationPrompt}". They said: "${transcript}". Please analyze their response for grammatical accuracy, clarity, and relevance to the prompt. Ignore any potential pronunciation mistakes as you are only analyzing the text.`;
      const response = await generateContent(prompt, undefined, personaInstructions[settings.persona]);
      if(response) setPronunciationFeedback(response.text);
      setIsSubmitting(false);
  }
  
  const initializeChat = async () => {
      setIsLoading(true); setChatHistory([]);
      const newChat = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: { systemInstruction: personaInstructions[settings.persona] + ` You are having a conversation with a ${difficultyLevels[settings.difficulty]} level English learner.` }
      });
      setChat(newChat);
      setChatHistory([{ role: 'model', text: 'Hello! What would you like to talk about today?' }]);
      setIsLoading(false);
  };
  
  const sendChatMessage = async (e: React.FormEvent) => {
      e.preventDefault(); if (!chatMessage || !chat) return;
      const userMessage = chatMessage;
      setChatMessage('');
      setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);
      setIsSubmitting(true);

      const response = await chat.sendMessage({ message: userMessage });
      setChatHistory(prev => [...prev, { role: 'model', text: response.text }]);
      setIsSubmitting(false);
  };
  
  const searchDictionary = async (e: React.FormEvent) => {
    e.preventDefault(); if(!dictionaryWord) return;
    setIsSubmitting(true); setDictionaryResult(null);
    const schema = {type: Type.OBJECT, properties: { word: {type: Type.STRING}, partOfSpeech: {type: Type.STRING}, definition: {type: Type.STRING}, example: {type: Type.STRING}}, required: ['word', 'partOfSpeech', 'definition', 'example']};
    const prompt = `Provide a dictionary entry for the word "${dictionaryWord}".`;
    const response = await generateContent(prompt, schema);
    if(response) setDictionaryResult(JSON.parse(response.text));
    setIsSubmitting(false);
  };

  const generateVocabulary = async () => {
    setIsLoading(true); setVocabularyList([]);
    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: { word: {type: Type.STRING}, definition: {type: Type.STRING}, example: {type: Type.STRING} },
            required: ['word', 'definition', 'example']
        }
    };
    const prompt = `Generate a list of 5 vocabulary words appropriate for a ${difficultyLevels[settings.difficulty]} English learner. For each word, provide a simple definition and an example sentence.`;
    const response = await generateContent(prompt, schema);
    if(response) setVocabularyList(JSON.parse(response.text));
    setIsLoading(false);
  };

  const generateTranslationTask = async () => {
    setIsLoading(true); setUserTranslation(''); setTranslationTask({sentence: '', feedback: ''});
    const prompt = `Provide a single, interesting English sentence to be translated into Spanish, appropriate for a ${difficultyLevels[settings.difficulty]} level learner. Just the sentence, no extra text.`;
    const response = await generateContent(prompt);
    if(response) setTranslationTask({sentence: response.text, feedback: ''});
    setIsLoading(false);
  };

  const checkTranslation = async (e: React.FormEvent) => {
    e.preventDefault(); if(!userTranslation) return;
    setIsSubmitting(true);
    const prompt = `A ${difficultyLevels[settings.difficulty]} learner was asked to translate "${translationTask.sentence}" into Spanish. Their translation was "${userTranslation}". Provide feedback on the translation's accuracy and grammar in simple English.`;
    const response = await generateContent(prompt, undefined, personaInstructions[settings.persona]);
    if(response) setTranslationTask(prev => ({ ...prev, feedback: response.text }));
    setIsSubmitting(false);
  };

  const analyzeWriting = async (e: React.FormEvent) => {
    e.preventDefault(); if(!writingInput) return;
    setIsSubmitting(true); setWritingFeedback(null);
    const schema = {
        type: Type.OBJECT,
        properties: {
            overall: { type: Type.STRING, description: "Overall feedback on the text." },
            grammar: { type: Type.STRING, description: "Specific feedback on grammar and correctness." },
            style: { type: Type.STRING, description: "Feedback on writing style, tone, and flow." },
            vocabulary: { type: Type.STRING, description: "Feedback on word choice and vocabulary usage." }
        },
        required: ['overall', 'grammar', 'style', 'vocabulary']
    };
    const prompt = `Analyze the following English text written by a ${difficultyLevels[settings.difficulty]} level learner. Provide structured feedback. \n\nText: "${writingInput}"`;
    const response = await generateContent(prompt, schema, personaInstructions[settings.persona]);
    if(response) setWritingFeedback(JSON.parse(response.text));
    setIsSubmitting(false);
  };

  const generatePhrasalVerb = async () => {
    setIsLoading(true); setPhrasalVerb(null);
    const schema = { type: Type.OBJECT, properties: { verb: {type: Type.STRING}, definition: {type: Type.STRING}, example: {type: Type.STRING} }, required: ['verb', 'definition', 'example'] };
    const prompt = `Provide one common English phrasal verb, its definition, and an example sentence. It should be suitable for a ${difficultyLevels[settings.difficulty]} learner.`;
    const response = await generateContent(prompt, schema);
    if(response) setPhrasalVerb(JSON.parse(response.text));
    setIsLoading(false);
  };
  
  const generateCommonPhrase = async () => {
    setIsLoading(true); setCommonPhrase(null);
    const schema = { type: Type.OBJECT, properties: { phrase: {type: Type.STRING}, meaning: {type: Type.STRING}, example: {type: Type.STRING} }, required: ['phrase', 'meaning', 'example'] };
    const prompt = `Provide one common English idiom or phrase, its meaning, and an example sentence. It should be suitable for a ${difficultyLevels[settings.difficulty]} learner.`;
    const response = await generateContent(prompt, schema);
    if(response) setCommonPhrase(JSON.parse(response.text));
    setIsLoading(false);
  };

  // --- Exam Functions ---
  const handleExamSettingChange = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => setExamSettings(prev => ({ ...prev, [key]: value }));
  
  const startExam = async () => {
    setIsLoading(true);
    setExamQuestions([]);
    setUserAnswers([]);
    setCurrentQuestionIndex(0);
    setCurrentAnswer('');
    setExamResults(null);

    const questionSchema = {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.NUMBER },
        type: { type: Type.STRING, enum: ['mcq', 'writing', 'speaking', 'listening'] },
        text: { type: Type.STRING },
        options: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ['id', 'type', 'text']
    };

    const schema = {
      type: Type.ARRAY,
      items: questionSchema,
    };

    const prompt = `Generate a ${examSettings.type} exam with ${examSettings.questions} questions for an English learner at the ${difficultyLevels[settings.difficulty]} level. For MCQ questions, provide 4 options. For writing, speaking, and listening, just provide the prompt/question text. Ensure question IDs are sequential starting from 1.`;
    const response = await generateContent(prompt, schema);

    if (response) {
      try {
        const questions = JSON.parse(response.text);
        setExamQuestions(questions);
        setExamState('in-progress');
      } catch (e) {
        console.error("Failed to parse exam questions:", e);
        setError("Failed to create the exam. Please try again.");
      }
    }
    setIsLoading(false);
  };

  const handleNextQuestion = () => {
    const newAnswer: UserAnswer = { questionId: examQuestions[currentQuestionIndex].id, answer: currentAnswer };
    const updatedAnswers = [...userAnswers.filter(a => a.questionId !== newAnswer.questionId), newAnswer];
    setUserAnswers(updatedAnswers);
    
    if (currentQuestionIndex < examQuestions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        const nextQuestionAnswer = updatedAnswers.find(a => a.questionId === examQuestions[currentQuestionIndex + 1].id);
        setCurrentAnswer(nextQuestionAnswer?.answer || '');
    } else {
        gradeExam(updatedAnswers);
    }
  };

  const gradeExam = async (finalAnswers: UserAnswer[]) => {
    setIsLoading(true);
    setExamState('results');

    const resultSchema = {
      type: Type.OBJECT,
      properties: {
        overallScore: { type: Type.NUMBER },
        summary: { type: Type.STRING },
        feedback: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionId: { type: Type.NUMBER },
              questionText: { type: Type.STRING },
              userAnswer: { type: Type.STRING },
              isCorrect: { type: Type.BOOLEAN },
              feedback: { type: Type.STRING },
            },
            required: ['questionId', 'questionText', 'userAnswer', 'isCorrect', 'feedback'],
          }
        }
      },
      required: ['overallScore', 'summary', 'feedback']
    };

    const prompt = `An English learner at the ${difficultyLevels[settings.difficulty]} level has completed an exam. Here are the questions and their answers. Please grade the exam and provide an overall score (out of 100), a summary, and feedback for each question.
    
    Questions: ${JSON.stringify(examQuestions)}
    User Answers: ${JSON.stringify(finalAnswers)}
    `;

    const response = await generateContent(prompt, resultSchema, personaInstructions[settings.persona]);

    if (response) {
      try {
        const results = JSON.parse(response.text);
        setExamResults(results);
      } catch (e) {
        console.error("Failed to parse exam results:", e);
        setError("Failed to grade the exam. Please try again later.");
        setExamState('setup');
      }
    } else {
        setError("Failed to grade the exam. Please try again later.");
        setExamState('setup');
    }
    setIsLoading(false);
  };

  // --- Render Functions ---
  const SkeletonLoader = ({ lines = 3, type = 'text' }: { lines?: number; type?: 'text' | 'card' | 'title' }) => (
    <div className={`skeleton-loader ${type}`}>
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton-line"></div>)}
    </div>
  );

  const renderHome = () => (
    <>
      <div className="content-card dashboard-welcome">
        <h2>Welcome to LingoSphere AI</h2>
        <p>Your personal AI-powered English learning companion. Select an activity to begin.</p>
      </div>
      <div className="dashboard-grid">
        <div className="content-card">
          <h3>Word of the Day</h3>
          {wordOfTheDay ? (
            <div className="word-of-the-day">
              <strong>{wordOfTheDay.word}</strong>
              <p>{wordOfTheDay.definition}</p>
              <em>e.g., "{wordOfTheDay.example}"</em>
            </div>
          ) : <SkeletonLoader />}
        </div>
        <div className="content-card">
          <h3>Suggested Activities</h3>
          <div className="suggestion-buttons">
            <button className="button secondary" onClick={() => changeView('story')}>Practice a Story</button>
            <button className="button secondary" onClick={() => changeView('conversation')}>Chat with AI</button>
            <button className="button secondary" onClick={() => changeView('exams')}>Take an Exam</button>
          </div>
        </div>
      </div>
    </>
  );

  const renderStory = () => (
    <div className="content-card">
      {isLoading ? <SkeletonLoader lines={5} /> : (
        <>
          <div className="story-container">{story.text.split('\n').map((p, i) => <p key={i}>{p}</p>)}</div>
          <div className="story-question">{story.question}</div>
          <form className="form-container" onSubmit={checkStoryAnswer}>
            <input type="text" className="answer-input" value={storyAnswer} onChange={e => setStoryAnswer(e.target.value)} placeholder="Type your answer here..." />
            <button className="button" type="submit" disabled={isSubmitting || !storyAnswer}>
              {isSubmitting ? 'Checking...' : 'Check Answer'}
            </button>
          </form>
          {isSubmitting && <div className="loader-container"><div className="loader small"></div></div>}
          {storyFeedback && <div className="ai-feedback">{storyFeedback}</div>}
        </>
      )}
    </div>
  );
  
  const renderSpeaking = () => (
     <div className="content-card">
      <h3>Pronunciation Practice</h3>
      {isLoading ? <SkeletonLoader /> : <div className="pronunciation-prompt">{pronunciationPrompt}</div>}
      <div className="pronunciation-controls">
         <button onClick={handlePronunciation} className={`button record-button ${isRecording ? 'recording' : ''}`}>
             <span className="material-symbols-outlined">{isRecording ? 'stop_circle' : 'mic'}</span>
             {isRecording ? 'Stop Recording' : 'Start Recording'}
         </button>
         {transcript && <button className="button" onClick={analyzeSpeech} disabled={isSubmitting}>Analyze Speech</button>}
      </div>
      {transcript && <div className="transcript-box"><strong>Transcript:</strong> {transcript}</div>}
      {isSubmitting && <div className="loader-container"><div className="loader small"></div></div>}
      {pronunciationFeedback && <div className="ai-feedback">{pronunciationFeedback}</div>}
     </div>
  );
  
  const renderConversation = () => (
    <div className="content-card">
      {isLoading ? <SkeletonLoader lines={6} /> : (
        <>
          <div className="chat-container" ref={chatContainerRef}>
              {chatHistory.map((msg, index) => (
                  <div key={index} className={`chat-message ${msg.role}`}>
                      {msg.text}
                  </div>
              ))}
              {isSubmitting && <div className="chat-message model typing-indicator"><span></span><span></span><span></span></div>}
          </div>
          <form className="form-container" onSubmit={sendChatMessage}>
              <input type="text" className="answer-input" value={chatMessage} onChange={e => setChatMessage(e.target.value)} placeholder="Type your message..." />
              <button className="button" type="submit" disabled={isSubmitting || !chatMessage}>Send</button>
          </form>
        </>
      )}
    </div>
  );
  
  const renderDictionary = () => (
    <div className="content-card">
      <form className="form-container" onSubmit={searchDictionary}>
        <input type="text" className="answer-input" value={dictionaryWord} onChange={e => setDictionaryWord(e.target.value)} placeholder="Enter a word..."/>
        <button className="button" type="submit" disabled={isSubmitting || !dictionaryWord}>Search</button>
      </form>
      {isSubmitting && <div className="loader-container"><div className="loader small"></div></div>}
      {dictionaryResult && (
        <div className="dictionary-result-card">
          <h3>{dictionaryResult.word}</h3>
          <span>({dictionaryResult.partOfSpeech})</span>
          <p>{dictionaryResult.definition}</p>
          <em>e.g., "{dictionaryResult.example}"</em>
        </div>
      )}
    </div>
  );

  const renderVocabulary = () => (
    <div className="content-card">
        {isLoading ? <SkeletonLoader lines={10} /> : (
            <>
                <div className="vocabulary-list">
                    {vocabularyList.map((item, index) => (
                        <div key={index} className="vocabulary-item">
                            <h4>{item.word}</h4>
                            <p>{item.definition}</p>
                            <em>e.g., "{item.example}"</em>
                        </div>
                    ))}
                </div>
                <div className="action-bar">
                    <button className="button" onClick={generateVocabulary}>New List</button>
                </div>
            </>
        )}
    </div>
  );

  const renderTranslation = () => (
      <div className="content-card">
          {isLoading ? <SkeletonLoader lines={4} /> : (
              <div className="translation-container">
                  <p className="translation-prompt">Translate the following sentence into Spanish:</p>
                  <h3>"{translationTask.sentence}"</h3>
                  <form className="form-container" onSubmit={checkTranslation}>
                      <textarea
                          className="answer-input"
                          value={userTranslation}
                          onChange={e => setUserTranslation(e.target.value)}
                          placeholder="Escribe tu traducción aquí..."
                      />
                      <button className="button" type="submit" disabled={isSubmitting || !userTranslation}>
                          {isSubmitting ? 'Checking...' : 'Check Translation'}
                      </button>
                  </form>
                  {isSubmitting && <div className="loader-container"><div className="loader small"></div></div>}
                  {translationTask.feedback && <div className="ai-feedback">{translationTask.feedback}</div>}
                  <div className="action-bar">
                    <button className="button secondary" onClick={generateTranslationTask}>Next Task</button>
                  </div>
              </div>
          )}
      </div>
  );
  
  const renderWritingAnalysis = () => (
    <div className="content-card">
        <form onSubmit={analyzeWriting}>
            <textarea
                className="writing-input"
                value={writingInput}
                onChange={e => setWritingInput(e.target.value)}
                placeholder="Paste or write your English text here for analysis..."
            />
            <button className="button" type="submit" disabled={isSubmitting || !writingInput}>
                {isSubmitting ? 'Analyzing...' : 'Analyze Text'}
            </button>
        </form>
        {isSubmitting && <div className="loader-container"><div className="loader small"></div></div>}
        {writingFeedback && (
            <div className="structured-feedback">
                <h4>Overall Feedback</h4>
                <p>{writingFeedback.overall}</p>
                <h4>Grammar</h4>
                <p>{writingFeedback.grammar}</p>
                <h4>Style</h4>
                <p>{writingFeedback.style}</p>
                <h4>Vocabulary</h4>
                <p>{writingFeedback.vocabulary}</p>
            </div>
        )}
    </div>
  );

  const renderPhrasalVerbs = () => (
    <div className="content-card">
        {isLoading ? <SkeletonLoader lines={4} /> : (
            phrasalVerb &&
            <>
                <div className="single-item-card">
                    <h2>{phrasalVerb.verb}</h2>
                    <p>{phrasalVerb.definition}</p>
                    <em>e.g., "{phrasalVerb.example}"</em>
                </div>
                <div className="action-bar">
                    <button className="button" onClick={generatePhrasalVerb}>Next Verb</button>
                </div>
            </>
        )}
    </div>
  );

  const renderPhrases = () => (
    <div className="content-card">
        {isLoading ? <SkeletonLoader lines={4} /> : (
            commonPhrase &&
            <>
                <div className="single-item-card">
                    <h2>{commonPhrase.phrase}</h2>
                    <p>{commonPhrase.meaning}</p>
                    <em>e.g., "{commonPhrase.example}"</em>
                </div>
                <div className="action-bar">
                    <button className="button" onClick={generateCommonPhrase}>Next Phrase</button>
                </div>
            </>
        )}
    </div>
  );


  const renderExams = () => {
    if (isLoading && examState !== 'results') {
      return <div className="content-card"><SkeletonLoader lines={8} /></div>;
    }

    if (examState === 'results') {
      if (!examResults || isLoading) {
        return (
          <div className="content-card">
            <h2>Grading...</h2>
            <p>Please wait while we grade your exam.</p>
            <div className="loader-container"><div className="loader"></div></div>
          </div>
        );
      }
      return (
        <div className="content-card">
          <h2>Exam Results</h2>
          <div className="results-summary">
            <h3>Overall Score: {examResults.overallScore}/100</h3>
            <p>{examResults.summary}</p>
          </div>
          <div className="results-breakdown">
            <h4>Detailed Feedback:</h4>
            {examResults.feedback.map(item => (
              <div key={item.questionId} className={`feedback-item ${item.isCorrect ? 'correct' : 'incorrect'}`}>
                <p><strong>Q: {item.questionText}</strong></p>
                <p>Your Answer: {item.userAnswer}</p>
                <p><em>Feedback: {item.feedback}</em></p>
              </div>
            ))}
          </div>
          <button className="button" onClick={() => { setExamState('setup'); setExamResults(null); }}>Take Another Exam</button>
        </div>
      );
    }

    if (examState === 'in-progress') {
      if (!examQuestions.length) return <div className="content-card"><p>Loading questions...</p><SkeletonLoader /></div>;
      const question = examQuestions[currentQuestionIndex];
      return (
        <div className="content-card">
          <h3>Question {currentQuestionIndex + 1} of {examQuestions.length}</h3>
          <p className="exam-question-text">{question.text}</p>
          {question.type === 'mcq' && question.options && (
            <div className="mcq-options">
              {question.options.map(option => (
                <button
                  key={option}
                  className={`button option-button ${currentAnswer === option ? 'selected' : ''}`}
                  onClick={() => setCurrentAnswer(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {(question.type === 'writing' || question.type === 'speaking' || question.type === 'listening') && (
            <textarea
              className="answer-input large"
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder={
                question.type === 'speaking' ? "Transcribe what you would say..." :
                question.type === 'listening' ? "Answer based on the audio prompt..." :
                "Write your answer here..."
              }
            />
          )}
          <button className="button" onClick={handleNextQuestion} disabled={!currentAnswer}>
            {currentQuestionIndex < examQuestions.length - 1 ? 'Next Question' : 'Finish & Grade Exam'}
          </button>
        </div>
      );
    }

    return (
      <div className="content-card exam-setup-container">
        <h2>Exam Setup</h2>
        <div className="setup-option-group">
          <label className="setting-label">Exam Type</label>
          <div className="option-buttons">
            <button className={`option-button ${examSettings.type === 'comprehensive' ? 'selected' : ''}`} onClick={() => handleExamSettingChange('type', 'comprehensive')}>Comprehensive</button>
            <button className={`option-button ${examSettings.type === 'reading_vocab' ? 'selected' : ''}`} onClick={() => handleExamSettingChange('type', 'reading_vocab')}>Reading & Vocab</button>
            <button className={`option-button ${examSettings.type === 'writing_grammar' ? 'selected' : ''}`} onClick={() => handleExamSettingChange('type', 'writing_grammar')}>Writing & Grammar</button>
            <button className={`option-button ${examSettings.type === 'listening_speaking' ? 'selected' : ''}`} onClick={() => handleExamSettingChange('type', 'listening_speaking')}>Listening & Speaking</button>
          </div>
        </div>
        <div className="setup-option-group">
          <label className="setting-label">Number of Questions</label>
          <div className="option-buttons">
            <button className={`option-button ${examSettings.questions === 5 ? 'selected' : ''}`} onClick={() => handleExamSettingChange('questions', 5)}>5</button>
            <button className={`option-button ${examSettings.questions === 10 ? 'selected' : ''}`} onClick={() => handleExamSettingChange('questions', 10)}>10</button>
            <button className={`option-button ${examSettings.questions === 15 ? 'selected' : ''}`} onClick={() => handleExamSettingChange('questions', 15)}>15</button>
          </div>
        </div>
        <button className="button" onClick={startExam} disabled={isLoading}>
          {isLoading ? 'Generating...' : 'Start Exam'}
        </button>
      </div>
    );
  };

  const renderContent = () => {
    switch(activeView) {
      case 'home': return renderHome();
      case 'story': return renderStory();
      case 'pronunciation': return renderSpeaking();
      case 'conversation': return renderConversation();
      case 'dictionary': return renderDictionary();
      case 'exams': return renderExams();
      case 'vocabulary': return renderVocabulary();
      case 'translation': return renderTranslation();
      case 'writingAnalysis': return renderWritingAnalysis();
      case 'phrasalVerbs': return renderPhrasalVerbs();
      case 'phrases': return renderPhrases();
      default: return <div className="content-card"><h2>{viewNames[activeView]}</h2><p>Content for this section is under construction.</p></div>;
    }
  };

  const SettingsPanel = () => (
    <div className="settings-panel">
      <h3 className="setting-title">Settings</h3>
      <div className="setting-group">
        <label className="setting-label">Difficulty</label>
        <div className="control-group">
          {Object.keys(difficultyLevels).map(level => (
            <button key={level} className={`control-button ${settings.difficulty === level ? 'active' : ''}`} onClick={() => handleSettingChange('difficulty', level as Difficulty)}>
              {difficultyLevels[level as Difficulty]}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-group">
        <label className="setting-label">Tutor Persona</label>
        <div className="control-group">
          {Object.keys(personaTypes).map(type => (
            <button key={type} className={`control-button ${settings.persona === type ? 'active' : ''}`} onClick={() => handleSettingChange('persona', type as Persona)}>
              {personaTypes[type as Persona]}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-group">
        <label className="setting-label">Theme</label>
        <div className="control-group">
          <button className={`control-button ${settings.theme === 'light' ? 'active' : ''}`} onClick={() => handleSettingChange('theme', 'light')}>
            <span className="material-symbols-outlined">light_mode</span>
          </button>
          <button className={`control-button ${settings.theme === 'dark' ? 'active' : ''}`} onClick={() => handleSettingChange('theme', 'dark')}>
            <span className="material-symbols-outlined">dark_mode</span>
          </button>
        </div>
      </div>
    </div>
  );

  const Navigation = () => {
    const bottomNavItems: View[] = ['home', 'story', 'conversation', 'exams'];
    return (
      <>
        <nav className="sidebar-nav">
          <div className="nav-header">
            <span className="material-symbols-outlined logo-icon">language</span>
            <h1>LingoSphere AI</h1>
          </div>
          <ul className="nav-menu">
            {Object.keys(viewIcons).map(key => (
              <li key={key} className={`nav-item ${activeView === key ? 'active' : ''}`} onClick={() => changeView(key as View)}>
                <span className="material-symbols-outlined">{viewIcons[key as View]}</span>
                <span>{viewNames[key as View]}</span>
              </li>
            ))}
          </ul>
          <SettingsPanel />
        </nav>
        <nav className="bottom-nav">
          {bottomNavItems.map(view => (
            <div key={view} className={`nav-item ${activeView === view ? 'active' : ''}`} onClick={() => changeView(view)}>
              <span className="material-symbols-outlined">{viewIcons[view]}</span>
              <span>{viewNames[view]}</span>
            </div>
          ))}
          <div className="nav-item" onClick={() => setIsSettingsOpen(true)}>
            <span className="material-symbols-outlined">tune</span>
            <span>Settings</span>
          </div>
        </nav>
      </>
    )
  };

  const MobileSettingsPortal = () => {
      if (!isSettingsOpen) return null;

      return createPortal(
          <div className="mobile-settings-backdrop" onClick={() => setIsSettingsOpen(false)}>
              <div className="mobile-settings-panel" onClick={e => e.stopPropagation()}>
                  <SettingsPanel />
              </div>
          </div>,
          document.getElementById('mobile-settings-root')!
      );
  };
  
  const TranslationPopup = () => {
    if (!popup.original) return null;
    return (
      <div className="translation-popup" style={{ top: `${popup.y}px`, left: `${popup.x}px` }}>
        {popup.loading ? <div className="loader small-popup"></div> : (
          <p><strong>{popup.original}</strong>: {popup.text}</p>
        )}
      </div>
    );
  };

  return (
    <>
      <Navigation />
      <main className="main-content" ref={mainContentRef}>
        <h2 className="page-title">{viewNames[activeView]}</h2>
        {error && <p className="error-message">{error}</p>}
        {renderContent()}
      </main>
      <TranslationPopup />
      <MobileSettingsPortal />
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);