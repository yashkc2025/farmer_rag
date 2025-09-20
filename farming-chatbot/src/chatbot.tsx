import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Bot, User, Mic, Pause, Play } from "lucide-react";

type ChatMessage = {
  id: string;
  type: "user" | "bot";
  content: string;
  timestamp: Date;
  audioUrl?: string | null;
  image?: string | null;
};

const API_URL = import.meta.env.VITE_API_URL || "";

const quickQuestions = [
  "What fertilizer should I use for wheat?",
  "How to control aphids naturally?",
  "Current mandi prices for rice",
  "PM-KISAN scheme eligibility",
];

const AIAdvisory: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      type: "bot",
      content:
        "🌱 Hello! I'm KhetSense – your AI-powered farming assistant. You can ask me questions about crops, farming practices, or schemes, send images for analysis, and even chat using voice . How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState("en-IN");
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);
  const [activeAudio, setActiveAudio] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const audioChunks = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  // Cleanup effect (runs on unmount)
  useEffect(() => {
    return () => {
      // Cleanup audio player
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = "";
      }

      // Cleanup media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      // Stop recording if active
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [audioPlayer]);

  // Reset effect (runs only once on page load/refresh)
  useEffect(() => {
    const resetAudio = async () => {
      try {
        await fetch(`${API_URL}/reset-audio`, { method: "POST" });
        console.log("✅ Audio folder reset on reload");
      } catch (err) {
        console.error("❌ Failed to reset audio folder:", err);
      }
    };

    resetAudio();
  }, []); // <-- empty array means it runs only once

  // ----------- Image Handling -----------
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  // ----------- TTS -----------
  const textToSpeech = async (text: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/api/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: currentLanguage }),
      });

      if (!res.ok) {
        console.error(`TTS HTTP error! status: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (data.audio_url) {
        return data.audio_url;
      } else {
        console.error("TTS: No audio_url in response", data);
        return null;
      }
    } catch (err) {
      console.error("TTS error:", err);
      return null;
    }
  };

  const togglePlayback = (messageId: string, audioUrl: string) => {
    try {
      if (activeAudio === messageId) {
        audioPlayer?.pause();
        setActiveAudio(null);
      } else {
        if (audioPlayer) {
          audioPlayer.pause();
        }
        const newAudio = new Audio(audioUrl);
        setAudioPlayer(newAudio);

        newAudio.onplay = () => setActiveAudio(messageId);
        newAudio.onended = () => setActiveAudio(null);
        newAudio.onpause = () => setActiveAudio(null);
        newAudio.onerror = (e) => {
          console.error("Audio playback error:", e);
          setActiveAudio(null);
        };

        newAudio.play().catch((err) => {
          console.error("Failed to play audio:", err);
          setActiveAudio(null);
        });
      }
    } catch (err) {
      console.error("Playback toggle error:", err);
      setActiveAudio(null);
    }
  };

  // ----------- STT -----------
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: "audio/wav" });
        await sendAudioToChat(audioBlob);
        // Clean up media stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleMicClick = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const sendAudioToChat = async (audioBlob: Blob) => {
    setIsProcessingAudio(true);
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.wav");
    formData.append("language", currentLanguage);
    if (sessionId) formData.append("session_id", sessionId);

    try {
      const res = await fetch(`${API_URL}/api/audio-chat`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();

      // Update session ID if provided
      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      if (data.response && data.transcript) {
        const userMsg: ChatMessage = {
          id: Date.now().toString(),
          type: "user",
          content: data.transcript,
          timestamp: new Date(),
        };
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: "bot",
          content: data.response,
          timestamp: new Date(),
          audioUrl: await textToSpeech(data.response),
        };
        setMessages((prev) => [...prev, userMsg, botMsg]);
      } else {
        console.error("Invalid response format:", data);
      }
    } catch (err) {
      console.error("Audio chat failed:", err);
      // Add error message to chat
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content:
          "Sorry, I couldn't process your audio. Please try again or type your message.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessingAudio(false);
    }
  };

  // ----------- Text Chat -----------
  const handleSendMessage = async () => {
    if (!inputMessage.trim() && !imageFile) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: inputMessage,
      timestamp: new Date(),
      image: imagePreview,
    };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = inputMessage;
    setInputMessage("");
    setIsTyping(true);

    try {
      let res;
      if (imageFile) {
        // Image + text chat
        const formData = new FormData();
        formData.append("image", imageFile);
        formData.append("message", currentInput);
        formData.append("language", currentLanguage);
        if (sessionId) formData.append("session_id", sessionId);

        res = await fetch(`${API_URL}/api/chat/image`, {
          method: "POST",
          body: formData,
        });
      } else {
        // Text-only chat
        const formData = new FormData();
        formData.append("message", currentInput);
        formData.append("language", currentLanguage);
        if (sessionId) formData.append("session_id", sessionId);

        res = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          body: formData,
        });
      }

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();

      // Update session ID if provided
      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      if (data.response) {
        const botMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: "bot",
          content: data.response,
          timestamp: new Date(),
          audioUrl: await textToSpeech(data.response),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      console.error("Chat error:", err);
      // Add error message to chat
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content: "Sorry, I couldn't process your message. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
      clearImage(); // Clear image after sending
    }
  };

  const handleQuickQuestion = async (q: string) => {
    if (!q.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: q,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const formData = new FormData();
      formData.append("message", q);
      formData.append("language", currentLanguage);
      if (sessionId) formData.append("session_id", sessionId);

      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();

      // Update session ID if provided
      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      if (data.response) {
        const botMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: "bot",
          content: data.response,
          timestamp: new Date(),
          audioUrl: await textToSpeech(data.response),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      console.error("Quick question error:", err);
      // Add error message to chat
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        type: "bot",
        content: "Sorry, I couldn't process your question. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-gray-950 text-gray-200 overflow-hidden">
      {/* HEADER */}
      <header className="bg-green-700 text-white py-3 sm:py-4 shadow-md w-full">
        <h1 className="text-center text-lg sm:text-xl md:text-2xl font-bold px-4">
          🌾 KhetSense – AI-Powered Farmer Assistant (RAG Call Center)
        </h1>
      </header>

      {/* MAIN CHAT */}
      <main className="flex-1 w-full px-2 sm:px-4 py-4 sm:py-6 flex flex-col items-center overflow-hidden">
        <div className="bg-gray-900 text-white rounded-none shadow-none border-0 w-full flex flex-col flex-1 overflow-hidden">
          {/* Chat messages */}
          <div className="flex-1 p-2 sm:p-4 overflow-y-auto space-y-3 sm:space-y-4 h-full">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${
                  m.type === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`flex items-start space-x-2 max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg ${
                    m.type === "user" ? "flex-row-reverse space-x-reverse" : ""
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      m.type === "user" ? "bg-green-600" : "bg-blue-600"
                    }`}
                  >
                    {m.type === "user" ? (
                      <User className="h-4 w-4 text-white" />
                    ) : (
                      <Bot className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <div
                    className={`px-4 py-2 rounded-lg text-sm ${
                      m.type === "user"
                        ? "bg-green-600 text-white"
                        : "bg-gray-800 text-gray-200"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <div>
                        <p>{m.content}</p>
                        {m.image && (
                          <img
                            src={m.image}
                            alt="uploaded"
                            className="mt-2 max-w-[150px] sm:max-w-[200px] md:max-w-[250px] rounded-lg border"
                          />
                        )}
                      </div>
                      {m.type === "bot" && m.audioUrl && (
                        <button
                          onClick={() => togglePlayback(m.id, m.audioUrl!)}
                          className="ml-2 text-gray-300 hover:text-white flex-shrink-0"
                        >
                          {activeAudio === m.id ? (
                            <Pause size={16} />
                          ) : (
                            <Play size={16} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {(isTyping || isProcessingAudio) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="flex items-start space-x-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-gray-800 px-4 py-2 rounded-lg text-gray-400">
                    {isProcessingAudio
                      ? "🎤 Processing audio..."
                      : "💭 Thinking..."}
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-gray-800 p-2 sm:p-3">
            {/* Image preview */}
            {imagePreview && (
              <div className="mb-2 sm:mb-3 flex items-center space-x-2">
                <img
                  src={imagePreview}
                  alt="preview"
                  className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg border object-cover"
                />
                <button
                  onClick={clearImage}
                  className="px-2 py-1 bg-red-600 text-white rounded text-xs sm:text-sm hover:bg-red-700"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="flex items-center space-x-1 sm:space-x-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  !isTyping &&
                  !isProcessingAudio &&
                  handleSendMessage()
                }
                placeholder={
                  isProcessingAudio
                    ? "Processing audio..."
                    : isRecording
                    ? "Recording..."
                    : "Ask me anything about farming..."
                }
                className="flex-1 px-2 sm:px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600 text-sm sm:text-base"
                disabled={isRecording || isProcessingAudio}
              />

              {/* Image upload */}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                id="image-upload"
                disabled={isRecording || isProcessingAudio}
              />
              <label
                htmlFor="image-upload"
                className={`px-2 sm:px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm sm:text-base ${
                  isRecording || isProcessingAudio
                    ? "bg-gray-600 opacity-50 cursor-not-allowed"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
                title="Upload image"
              >
                📷
              </label>

              <button
                onClick={handleMicClick}
                disabled={isProcessingAudio || isTyping}
                className={`px-2 sm:px-3 py-2 rounded-lg transition-colors touch-manipulation ${
                  isRecording
                    ? "bg-red-600 animate-pulse"
                    : isProcessingAudio
                    ? "bg-yellow-600 opacity-50 cursor-not-allowed"
                    : "bg-gray-700 hover:bg-gray-600 active:bg-gray-500"
                }`}
                title={
                  isProcessingAudio
                    ? "Processing audio..."
                    : isRecording
                    ? "Stop recording"
                    : "Start recording"
                }
              >
                <Mic className="h-4 w-4 text-white" />
              </button>
              <select
                onChange={(e) => setCurrentLanguage(e.target.value)}
                value={currentLanguage}
                className="px-1 sm:px-2 py-1 sm:py-2 rounded bg-gray-800 text-gray-200 text-xs sm:text-sm"
                disabled={isRecording || isProcessingAudio}
              >
                <option value="en-IN">EN</option>
                <option value="hi-IN">HI</option>
                <option value="bn-IN">BN</option>
                <option value="te-IN">TE</option>
                <option value="mr-IN">MR</option>
                <option value="ta-IN">TA</option>
                <option value="gu-IN">GU</option>
              </select>
              <button
                onClick={handleSendMessage}
                disabled={
                  isTyping ||
                  isProcessingAudio ||
                  (!inputMessage.trim() && !imageFile)
                }
                className="px-2 sm:px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed active:bg-green-800 touch-manipulation"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick Questions */}
        <div className="bg-gray-900 rounded-xl p-3 sm:p-4 shadow border border-gray-800 mt-4 sm:mt-6 w-full">
          <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-100">
            Quick Questions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleQuickQuestion(q)}
                className="text-left p-2 sm:p-3 rounded border border-gray-700 hover:bg-gray-800 active:bg-gray-700 text-gray-300 text-sm sm:text-base touch-manipulation"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-gray-950 text-gray-400 py-3 sm:py-4 border-t border-gray-800">
        <div className="container mx-auto text-center space-y-3 px-4">
          <div className="text-xs sm:text-sm">
            © 2025 Yash Kumar | IIT Madras | KhetSense (Kisan Call center RAG) |
            Data Science & Artificial Intelligence
          </div>

          {/* Social Links */}
          <div className="flex justify-center space-x-4 sm:space-x-6">
            <a
              href="https://github.com/yashkc2025"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1 sm:space-x-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
            >
              <svg
                height="16"
                width="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="sm:h-5 sm:w-5"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span className="hidden sm:inline">GitHub</span>
            </a>

            <a
              href="https://www.linkedin.com/in/yashkc2025"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1 sm:space-x-2 text-gray-400 hover:text-blue-400 transition-colors text-xs sm:text-sm"
            >
              <svg
                height="16"
                width="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="sm:h-5 sm:w-5"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              <span className="hidden sm:inline">LinkedIn</span>
            </a>

            <a
              href="mailto:yashkc2025@gmail.com"
              className="flex items-center space-x-1 sm:space-x-2 text-gray-400 hover:text-green-400 transition-colors text-xs sm:text-sm"
            >
              <svg
                height="16"
                width="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="sm:h-5 sm:w-5"
              >
                <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z" />
              </svg>
              <span className="hidden sm:inline">Contact</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AIAdvisory;
