import { useCallback, useEffect, useState } from "react";
import { supabase } from "../integrations/supabase/client";

export interface SmartNote {
  id: string;
  user_id: string;
  lesson_id: string | null;
  course_id: number | null;
  title: string;
  content_md: string;
  updated_at: string;
}

interface Args {
  lessonId?: string | null;
  courseId?: number | null;
  defaultTitle?: string;
}

/**
 * Loads a user's saved Smart Note for a given lesson (or course-level).
 * Returns `{ note, loading, save, refresh }`. `save(content_md, title?)` upserts.
 */
export function useSmartNote({ lessonId, courseId, defaultTitle = "Smart Note" }: Args) {
  const [note, setNote] = useState<SmartNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setUserId(data.user?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || (!lessonId && !courseId)) { setLoading(false); return; }
    setLoading(true);
    try {
      let q = supabase.from("smart_notes").select("*").eq("user_id", userId);
      q = lessonId ? q.eq("lesson_id", lessonId) : q.is("lesson_id", null).eq("course_id", courseId!);
      const { data, error } = await q.maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      setNote((data as SmartNote) ?? null);
    } catch (err) {
      console.error("useSmartNote: load failed", err);
    } finally {
      setLoading(false);
    }
  }, [userId, lessonId, courseId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(
    async (content_md: string, title?: string): Promise<SmartNote> => {
      if (!userId) throw new Error("Not signed in");
      if (!lessonId && !courseId) throw new Error("Missing lesson/course id");
      setSaving(true);
      try {
        const payload = {
          user_id: userId,
          lesson_id: lessonId ?? null,
          course_id: courseId ?? null,
          title: title ?? note?.title ?? defaultTitle,
          content_md,
          updated_at: new Date().toISOString(),
        };
        // Upsert on the partial unique index that matches this scope so
        // re-saves never create duplicates and parallel tabs converge.
        const onConflict = lessonId ? "user_id,lesson_id" : "user_id,course_id";
        const { data, error } = await supabase
          .from("smart_notes")
          .upsert(payload, { onConflict })
          .select()
          .single();
        if (error) {
          console.error("[useSmartNote] save failed", error);
          throw error;
        }
        setNote(data as SmartNote);
        return data as SmartNote;
      } finally {
        setSaving(false);
      }
    },
    [userId, lessonId, courseId, note, defaultTitle]
  );

  return { note, loading, saving, save, refresh };
}
