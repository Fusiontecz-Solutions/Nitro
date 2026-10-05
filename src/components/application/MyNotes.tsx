import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { RootState, AppDispatch } from "@/redux/store";
import { createNote, getNotes, deleteNote } from "@/redux/actions/noteActions";
import { resetCreateNote, resetDeleteNote } from "@/redux/slices/noteSlice";
import type { Note } from "@/types/noteTypes";
import type { user } from "@/redux/slices/authSlice";
import { isAdditionalInfoNoteContent } from "@/components/scrubbing/lib/additionalInfo";

interface MyNotesProps {
    applicationId?: string;
    notes?: Note[];
    onNoteAdd?: (note: Note) => void;
    onNoteDelete?: (noteId: string) => void;
    /** Tighter layout for embedded panels (e.g. Funding Call). */
    compact?: boolean;
    /** Extra vertical space when embedded in compact panels. */
    tall?: boolean;
    /** Stretch to the parent column (Offer + Notes side-by-side). */
    fillHeight?: boolean;
}

const MyNotes = ({
    applicationId: applicationIdProp,
    notes: externalNotes,
    onNoteAdd,
    onNoteDelete,
    compact = false,
    tall = false,
    fillHeight = false,
}: MyNotesProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const { applicationId: applicationIdFromRoute } = useParams<{ applicationId?: string }>();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [newNote, setNewNote] = useState("");

    // Redux state
    const { loading: notesLoading, data: notesData } = useSelector(
        (state: RootState) => state.notes
    );
    const { loading: createLoading, success: createSuccess, error: createError } = useSelector(
        (state: RootState) => state.createNote
    );
    const { loading: deleteLoading, success: deleteSuccess, error: deleteError } = useSelector(
        (state: RootState) => state.deleteNote
    );

    // Logged-in user (Redux + localStorage fallback)
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const [loggedInUser, setLoggedInUser] = useState<user | null>(null);

    const applicationId = applicationIdProp || applicationIdFromRoute;

    // Resolve logged-in user
    useEffect(() => {
        const userData = loginData?.user;
        if (userData && typeof userData === "object" && (userData as user)._id) {
            setLoggedInUser(userData as user);
            return;
        }

        const stored = localStorage.getItem("user");
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as user;
                if (parsed?._id) setLoggedInUser(parsed);
            } catch {
                // ignore parse errors
            }
        }
    }, [loginData]);

    // Fetch notes on component mount and when applicationId changes
    useEffect(() => {
        if (applicationId) {
            dispatch(getNotes({ application: applicationId }));
        }
    }, [applicationId, dispatch]);

    // Handle create success/error
    useEffect(() => {
        if (createSuccess) {
            toast.success('Note created successfully!');
            setNewNote("");
            dispatch(resetCreateNote());
            if (applicationId) {
                dispatch(getNotes({ application: applicationId }));
            }
        }
        if (createError) {
            toast.error(createError);
            dispatch(resetCreateNote());
        }
    }, [createSuccess, createError, dispatch, applicationId]);

    // Handle delete success/error
    useEffect(() => {
        if (deleteSuccess) {
            toast.success('Note deleted successfully');
            dispatch(resetDeleteNote());
            if (applicationId) {
                dispatch(getNotes({ application: applicationId }));
            }
        }
        if (deleteError) {
            toast.error(deleteError);
            dispatch(resetDeleteNote());
        }
    }, [deleteSuccess, deleteError, dispatch, applicationId]);

    // Use external notes if provided, otherwise use Redux data
    // Additional Info (Scrubbing tab) is stored as a special note — never list it as a note.
    const notes = (externalNotes || notesData || []).filter(
        (note) => !isAdditionalInfoNoteContent(note?.content),
    );

    const handlePostComment = () => {
        if (!newNote.trim()) {
            return;
        }

        if (!applicationId) {
            toast.error('Application ID is required');
            return;
        }

        // If external handlers are provided, use them (for backward compatibility)
        if (onNoteAdd) {
            const newNoteItem: Note = {
                _id: Date.now().toString(),
                content: newNote,
                application: applicationId,
            } as Note;
            onNoteAdd(newNoteItem);
            setNewNote("");
            return;
        }

        // Otherwise, use Redux API
        dispatch(createNote({
            content: newNote.trim(),
            application: applicationId,
        }));
    };

    const handleDeleteNote = (id: string) => {
        // If external handler is provided, use it (for backward compatibility)
        if (onNoteDelete) {
            onNoteDelete(id);
            return;
        }

        // Otherwise, use Redux API
        if (window.confirm('Are you sure you want to delete this note?')) {
            dispatch(deleteNote(id));
        }
    };

    // Helper function to format date
    const formatDate = (dateString?: string): string => {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });
    };

    // Helper function to format time
    const formatTime = (dateString?: string): string => {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).toLowerCase();
    };

    // Mirror CommentSection logic for createdBy display
    const getAvatarLetter = (name?: string) => {
        if (!name) return "U";
        return name.trim().charAt(0).toUpperCase();
    };

    const getUserInfo = (createdBy: Note["createdBy"]) => {
        if (!createdBy) return { name: "User", avatarLetter: "U", roleLabel: "", id: "" };
        if (typeof createdBy === "string") return { name: "User", avatarLetter: "U", roleLabel: "", id: createdBy };

        const name =
            `${(createdBy as any).firstName || ""} ${(createdBy as any).lastName || ""}`.trim() ||
            (createdBy as any).email ||
            "User";

        const roleRaw = (createdBy as any).role as string | undefined;
        const roleLabel = roleRaw
            ? roleRaw
                  .toString()
                  .toLowerCase()
                  .split("_")
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(" ")
            : "";

        const avatarLetter = getAvatarLetter(name);
        const id = (createdBy as any)._id as string | undefined;
        return { name, avatarLetter, roleLabel, id: id ?? "" };
    };

    const getNoteAuthor = (note: Note) => {
        const info = getUserInfo(note.createdBy);
        const createdById =
            typeof note.createdBy === "string" ? note.createdBy : (note.createdBy as any)?._id;
        const isOwnNote = !!loggedInUser && !!createdById && createdById === loggedInUser._id;

        return {
            ...info,
            displayName: isOwnNote ? "You" : info.name,
        };
    };

    return (
        <Card className={`gap-0 w-full border shadow-[0px_4px_20px_0px_#00000005] p-0 rounded-b-md flex flex-col ${
            compact
                ? (tall ? 'h-[560px] pb-2' : 'h-auto pb-2')
                : fillHeight
                  ? 'h-full min-h-0'
                  : 'h-auto'
        } ${
            isDark ? 'bg-[#141517] border-[#374151]' : 'border-[#FDFDFD]'
        }`}>
            <CardHeader className={`shrink-0 ${compact ? 'px-3 py-1.5' : 'px-4 py-2'} ${
                isDark ? 'bg-[#2A2B2F]' : 'bg-[#F9FAFD]'
            }`}>
                <CardTitle
                    className={`${compact ? 'text-sm' : 'text-base'} font-semibold uppercase tracking-wide ${
                        isDark ? 'text-white' : 'text-[#374151]'
                    }`}
                >
                    My Notes
                </CardTitle>
            </CardHeader>
            <CardContent className={`${compact ? 'px-3 pb-2' : 'px-4 pb-4'} flex-1 min-h-0 flex flex-col gap-3`}>
                {/* Add Notes Section — content-sized so it never overlaps the list */}
                <div className={`shrink-0 ${compact ? 'space-y-2' : 'space-y-3'}`}>
                    <p
                        className={`${compact ? 'text-xs' : 'text-sm'} font-semibold uppercase tracking-wide ${
                            isDark ? 'text-white' : 'text-[#374151]'
                        }`}
                    >
                        Add Notes
                    </p>
                    <Textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Write your notes here.."
                        className={`${
                            compact
                                ? (tall ? 'min-h-[140px]' : 'min-h-[72px]')
                                : 'min-h-[96px] max-h-[160px]'
                        } resize-y rounded-sm text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]/20 ${
                            isDark ? 'bg-[#141517] border-[#374151] text-white' : 'border-border'
                        }`}
                    />
                    <Button
                        onClick={handlePostComment}
                        className={`bg-[image:var(--brand-gradient)] hover:opacity-90 text-white text-xs font-semibold uppercase tracking-wide rounded-sm ${
                            compact ? 'h-8 w-28 px-4' : 'w-36 px-10 py-0'
                        }`}
                        disabled={createLoading || !applicationId}
                    >
                        {createLoading ? (
                            <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin inline" />
                                Posting…
                            </>
                        ) : (
                            'Post Note'
                        )}
                    </Button>
                </div>

                {/* Notes List */}
                <style>{`
                    .notes-scroll {
                        scrollbar-gutter: stable;
                        scrollbar-width: thin;
                        scrollbar-color: rgba(39, 109, 156, 1) rgba(39, 109, 156, 0.12);
                    }
                    .notes-scroll::-webkit-scrollbar {
                        width: 10px;
                    }
                    .notes-scroll::-webkit-scrollbar-track {
                        background: rgba(39, 109, 156, 0.10);
                        border-radius: 9999px;
                    }
                    .notes-scroll::-webkit-scrollbar-thumb {
                        background: linear-gradient(180deg, var(--brand) 0%, #0B5C86 100%);
                        border-radius: 9999px;
                        border: 2px solid rgba(255, 255, 255, 0.35);
                    }
                    .notes-scroll::-webkit-scrollbar-thumb:hover {
                        background: linear-gradient(180deg, #3B82F6 0%, var(--brand) 100%);
                        box-shadow: 0 0 0 3px rgba(39, 109, 156, 0.20);
                    }
                    .notes-scroll::-webkit-scrollbar-corner {
                        background: transparent;
                    }
                    .dark .notes-scroll {
                        scrollbar-color: rgba(147, 197, 253, 1) rgba(147, 197, 253, 0.10);
                    }
                    .dark .notes-scroll::-webkit-scrollbar-track {
                        background: rgba(147, 197, 253, 0.08);
                    }
                    .dark .notes-scroll::-webkit-scrollbar-thumb {
                        background: linear-gradient(180deg, #93C5FD 0%, var(--brand) 100%);
                        border: 2px solid rgba(20, 21, 23, 0.7);
                    }
                `}</style>
                <div
                    className={`notes-scroll space-y-2 min-h-0 overflow-y-auto pr-2 ${
                        compact
                            ? tall
                                ? 'mt-0 max-h-[400px]'
                                : 'mt-0 max-h-[180px]'
                            : fillHeight
                              ? 'flex-1 border-t border-slate-100 pt-3 dark:border-slate-700'
                              : 'max-h-[280px] border-t border-slate-100 pt-3 dark:border-slate-700'
                    }`}
                >
                    {notesLoading ? (
                        <div className={`text-center ${compact ? 'py-3' : 'py-4'}`}>
                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                            <p className={`text-sm mt-2 ${isDark ? 'text-white' : 'text-gray-500'}`}>Loading notes...</p>
                        </div>
                    ) : notes.length === 0 ? (
                        <div className={`text-center ${compact ? 'py-2' : 'py-3'} ${isDark ? 'text-white' : 'text-gray-500'}`}>
                            <p className="text-xs">No notes yet. Add your first note above!</p>
                        </div>
                    ) : (
                        notes.map((note) => {
                            const author = getNoteAuthor(note);
                            return (
                                <div
                                    key={note._id}
                                    className={`rounded-lg px-4 py-2 shadow-[0px_4px_20px_0px_rgba(0,0,0,0.02)] ${
                                        isDark ? 'bg-[#141517] border border-[#374151]' : 'bg-white border border-[#FDF0F0]'
                                    }`}
                                >
                                    <div className="mb-2 flex items-center justify-between">
                                        <div className={`flex items-center gap-1 text-xs font-medium ${
                                            isDark ? 'text-white' : 'text-gray-500'
                                        }`}>
                                            <span>{author.displayName}</span>
                                            {author.roleLabel && author.displayName !== "You" && (
                                                <span className="opacity-90">({author.roleLabel})</span>
                                            )}
                                            <span>|</span>
                                            <span>{formatDate(note.createdAt)}</span>
                                            <span>|</span>
                                            <span>{formatTime(note.createdAt)}</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteNote(note._id)}
                                            disabled={deleteLoading}
                                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                        >
                                            {deleteLoading ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Trash2 className="h-2 w-2" />
                                            )}
                                        </Button>
                                    </div>
                                    <p className={`text-sm leading-relaxed font-medium ${
                                    isDark ? 'text-white' : 'text-[#374151]'
                                }`}>{note.content}</p>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default MyNotes;

