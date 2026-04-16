import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import {
  processQuery,
  getSuggestedQuestions,
  getDataDictionary,
  getRegistryInfo,
} from "../engine/queryEngine.js";
import { registerCSV, removeDataset } from "../engine/dataRegistry.js";
import {
  getRestrictions,
  getRoles,
  getAccessRequests,
  approveRequest,
  denyRequest,
  createAccessRequest,
  applyApprovedRequests,
  resetRestrictionIndex,
} from "../engine/accessControl.js";
import { supabase } from "../lib/supabase.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  /* ── Auth ── */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authView, setAuthView] = useState("login"); // "login" | "signup"
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  /* ── Tab & Role ── */
  const [activeTab, setActiveTab]       = useState("company");
  const [role, setRole]                 = useState("Owner");

  /* ── Dropdown open states ── */
  const [roleOpen, setRoleOpen]         = useState(false);
  const [bellOpen, setBellOpen]         = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [dictOpen, setDictOpen]         = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);

  /* ── Input ── */
  const [input, setInput]               = useState("");

  /* ── Trust expand ── */
  const [expandedTrust, setExpandedTrust] = useState(null);

  /* ── Access requests (Supabase-backed) ── */
  const [accessRequests, setAccessRequests] = useState([]);

  /* ── Toast notification ── */
  const [notification, setNotification] = useState(null);

  /* ── Upload state ── */
  const [uploadedFile, setUploadedFile]         = useState(null);
  const [uploadedDatasetId, setUploadedDatasetId] = useState(null);
  const [uploadedDataType, setUploadedDataType] = useState("structured");

  /* ── Loading ── */
  const [isLoading, setIsLoading]       = useState(false);

  /* ── Per-role, per-tab chat storage ── */
  const [companyChats, setCompanyChats] = useState(() => {
    const initial = {};
    for (const r of getRoles()) {
      initial[r] = {
        chats: [{ id: 1, name: "New Chat", time: "just now", messages: [] }],
        activeChatId: 1,
      };
    }
    return initial;
  });

  const [uploadChat, setUploadChat] = useState({ messages: [] });

  /* ── Derived chat values ── */
  const isUploadTab    = activeTab === "upload";
  const roleChats      = companyChats[role]?.chats ?? [];
  const activeChatId   = companyChats[role]?.activeChatId ?? roleChats[0]?.id;
  const activeChat     = roleChats.find((c) => c.id === activeChatId) ?? roleChats[0];
  const currentMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
  const displayMessages = currentMessages;

  /* ── Derived engine values ── */
  const restrictions       = getRestrictions(role, currentUser?.id);
  const pendingCount       = accessRequests.filter((r) => r.status === "pending").length;
  const suggestedQuestions = getSuggestedQuestions(activeTab, uploadedDatasetId, role);
  const dataDictionary     = getDataDictionary(activeTab, uploadedDatasetId);
  const registryInfo       = getRegistryInfo();
  const roles              = getRoles();

  /* ── Refs ── */
  const chatEndRef  = useRef(null);
  const fileRef     = useRef(null);
  const roleRef     = useRef(null);
  const bellRef     = useRef(null);
  const registryRef = useRef(null);
  const dictRef     = useRef(null);
  const restrictRef = useRef(null);

  /* ── Fetch access requests from Supabase + sync restriction index ── */
  const fetchAccessRequests = useCallback(async () => {
    try {
      const requests = await getAccessRequests();
      // Rebuild restriction index from scratch then apply approved grants
      resetRestrictionIndex();
      applyApprovedRequests(requests);
      setAccessRequests(requests);
    } catch (err) {
      console.error("Failed to fetch access requests:", err);
    }
  }, []);

  /* ── Auto-scroll ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages, isLoading]);

  /* ── Click-outside to close dropdowns ── */
  useEffect(() => {
    const handler = (e) => {
      if (roleRef.current     && !roleRef.current.contains(e.target))     setRoleOpen(false);
      if (bellRef.current     && !bellRef.current.contains(e.target))     setBellOpen(false);
      if (registryRef.current && !registryRef.current.contains(e.target)) setRegistryOpen(false);
      if (dictRef.current     && !dictRef.current.contains(e.target))     setDictOpen(false);
      if (restrictRef.current && !restrictRef.current.contains(e.target)) setRestrictOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Build user object: reads role from profiles table (editable in Supabase dashboard),
        falls back to user_metadata if the profile row doesn't exist yet ── */
  const buildUser = useCallback(async (session) => {
    const meta = session.user.user_metadata;
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, role")
      .eq("id", session.user.id)
      .single();
    return {
      id:    session.user.id,
      email: session.user.email,
      name:  profile?.name  ?? meta?.name  ?? session.user.email,
      role:  profile?.role  ?? meta?.role  ?? "Owner",
    };
  }, []);

  /* ── Supabase auth: restore session on mount + listen for auth state changes ── */
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        const u = await buildUser(session);
        if (!mounted) return;
        setCurrentUser(u);
        setRole(u.role);
        setIsAuthenticated(true);
      }
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) {
        buildUser(session).then((u) => {
          if (!mounted) return;
          setCurrentUser(u);
          setRole(u.role);
          setIsAuthenticated(true);
        });
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
        setRole("Owner");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Real-time access requests: fetch on login + subscribe for live updates ── */
  useEffect(() => {
    if (!isAuthenticated) return;

    // Initial load
    fetchAccessRequests();

    // Subscribe to all changes on the access_requests table
    const channel = supabase
      .channel("access_requests_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "access_requests" },
        () => { fetchAccessRequests(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, fetchAccessRequests]);

  /* ── Auth functions ── */
  const login = async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch {
      return { success: false, message: "Something went wrong. Please try again." };
    }
  };

  const signup = async (name, email, password, selectedRole) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, role: selectedRole } },
      });
      if (error) return { success: false, message: error.message };
      return { success: true, needsOtp: true };
    } catch {
      return { success: false, message: "Something went wrong. Please try again." };
    }
  };

  const verifyOtp = async (email, token) => {
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch {
      return { success: false, message: "Something went wrong. Please try again." };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    resetRestrictionIndex();
    setAccessRequests([]);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setRole("Owner");
    setAuthView("login");
  };

  /* ── Toast ── */
  const showNotif = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  /* ── Push a message into the current active chat (tab-aware) ── */
  const pushMessage = (msg) => {
    if (activeTab === "upload") {
      setUploadChat((prev) => ({ messages: [...prev.messages, msg] }));
    } else {
      setCompanyChats((prev) => {
        const roleData = { ...prev[role] };
        roleData.chats = roleData.chats.map((c) => {
          if (c.id !== activeChatId) return c;
          const updated = { ...c, messages: [...c.messages, msg] };
          if (c.name === "New Chat" && msg.role === "user") {
            updated.name =
              msg.content.length > 30 ? msg.content.slice(0, 30) + "…" : msg.content;
          }
          return updated;
        });
        return { ...prev, [role]: roleData };
      });
    }
  };

  /* ── New Chat ── */
  const handleNewChat = () => {
    if (activeTab === "upload") {
      setUploadChat({ messages: [] });
      if (uploadedDatasetId) removeDataset(uploadedDatasetId);
      setUploadedFile(null);
      setUploadedDatasetId(null);
      setUploadedDataType("structured");
    } else {
      const newId = Date.now();
      setCompanyChats((prev) => {
        const roleData = { ...prev[role] };
        roleData.chats = [
          { id: newId, name: "New Chat", time: "just now", messages: [] },
          ...roleData.chats,
        ];
        roleData.activeChatId = newId;
        return { ...prev, [role]: roleData };
      });
    }
    setInput("");
    setExpandedTrust(null);
  };

  /* ── Switch Chat ── */
  const switchChat = (chatId) => {
    setCompanyChats((prev) => ({
      ...prev,
      [role]: { ...prev[role], activeChatId: chatId },
    }));
    setExpandedTrust(null);
  };

  /* ── Approve / Deny access request ── */
  const handleAccess = async (id, approved) => {
    try {
      if (approved) {
        await approveRequest(id);
      } else {
        await denyRequest(id);
      }
      // fetchAccessRequests will also be triggered by real-time subscription,
      // but call it here too so the UI updates immediately for the Owner.
      await fetchAccessRequests();
      showNotif(approved ? "Access approved successfully" : "Access request denied");
    } catch {
      showNotif("Failed to process request. Please try again.");
    }
  };

  /* ── Send question through engine ── */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    pushMessage({
      role: "user",
      content: text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    setInput("");
    setIsLoading(true);

    const ctxMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
    const context = ctxMessages.slice(-5).map((m) => ({
      role: m.role,
      content: m.content ?? "",
    }));

    try {
      const result = await processQuery(text, role, context, activeTab, uploadedDatasetId, currentUser);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (result.type === "blocked") {
        pushMessage({
          role: "assistant",
          blocked: true,
          blockedColumns: result.blockedColumns.map((b) => b.col),
          blockedReasons: result.blockedColumns,
          time,
        });
      } else if (result.type === "error") {
        pushMessage({
          role: "assistant",
          content: result.message ?? "An unexpected error occurred.",
          isError: true,
          time,
        });
      } else if (result.type === "text") {
        pushMessage({
          role: "assistant",
          content: result.answer,
          trust: {
            source: result.source,
            method: "LLM answer from uploaded unstructured dataset",
            datasetsUsed: result.datasetName ? [result.datasetName] : [],
            columnsUsed: [],
            rowsAnalyzed: result.rowCount ?? 0,
            aiPowered: true,
          },
          time,
        });
      } else {
        pushMessage({
          role: "assistant",
          content: result.narrative,
          chartData: result.chartData,
          chartType: result.chartType,
          title: result.title,
          trust: result.trust,
          rawResult: result.rawResult,
          time,
        });
      }
    } catch {
      pushMessage({
        role: "assistant",
        content: "Something went wrong while analyzing your data. Please try rephrasing your question.",
        isError: true,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── CSV / Excel upload ── */
  const handleFileUpload = async (file, datasetType = "structured") => {
    if (!file) return;
    setIsLoading(true);
    setUploadChat({ messages: [] });

    try {
      if (uploadedDatasetId) removeDataset(uploadedDatasetId);

      const entry = await registerCSV(file, {
        name: file.name.replace(/\.[^.]+$/, ""),
        type: datasetType,
      });
      setUploadedFile(file);
      setUploadedDatasetId(entry.id);
      setUploadedDataType(entry.type);

      const colLines = entry.columns
        .slice(0, 12)
        .map((c) => `• **${c.name}** (${c.type})${c.description ? ": " + c.description : ""}`)
        .join("\n");
      const extra = entry.columns.length > 12 ? `\n• …and ${entry.columns.length - 12} more columns` : "";

      setUploadChat({
        messages: [{
          role: "assistant",
          content: `Successfully loaded **${entry.name}** — ${entry.rowCount.toLocaleString()} rows and ${entry.columns.length} columns detected.\n\n${colLines}${extra}\n\nAsk me anything about your data!`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } catch {
      setUploadChat({
        messages: [{
          role: "assistant",
          content: "Failed to load the file. Please make sure it's a valid CSV file.",
          isError: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Request access (from AccessBlockedMsg) ── */
  const handleRequestAccess = async (columns) => {
    try {
      await createAccessRequest(role, currentUser?.id, currentUser?.name, columns, "Requested via query");
      await fetchAccessRequests();
      showNotif("Access request sent to data owner");
    } catch {
      showNotif("Failed to send access request. Please try again.");
    }
  };

  return (
    <AppContext.Provider
      value={{
        // Auth
        isAuthenticated, isAuthLoading, currentUser, authView, setAuthView,
        login, signup, verifyOtp, logout,
        // Tab
        activeTab, setActiveTab,
        // Role
        role, setRole, roles,
        // Dropdown open states
        roleOpen, setRoleOpen,
        bellOpen, setBellOpen,
        registryOpen, setRegistryOpen,
        dictOpen, setDictOpen,
        restrictOpen, setRestrictOpen,
        // Input
        input, setInput,
        // Trust
        expandedTrust, setExpandedTrust,
        // Access
        accessRequests, pendingCount,
        handleAccess, handleRequestAccess,
        // Notification
        notification, showNotif,
        // File
        uploadedFile, uploadedDatasetId,
        uploadedDataType, setUploadedDataType,
        handleFileUpload,
        // Loading
        isLoading,
        // Chats
        companyChats, roleChats, activeChatId, activeChat,
        uploadChat, isUploadTab,
        currentMessages, displayMessages,
        pushMessage, handleNewChat, switchChat,
        // Engine-derived (reactive)
        restrictions,
        suggestedQuestions,
        dataDictionary,
        registryInfo,
        // Refs
        chatEndRef, fileRef, roleRef, bellRef, registryRef, dictRef, restrictRef,
        // Main action
        handleSend,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
