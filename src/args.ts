const positive = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function extractPk(arg: unknown): number | undefined {
  if (typeof arg === "number" || typeof arg === "string") return positive(arg);
  if (arg && typeof arg === "object") {
    const a = arg as any;
    for (const candidate of [
      a.pk,
      a.problem?.pk,
      a.problemId,
      a.lessonId,
      a.problem?.id,
      a.command?.arguments?.[0],
    ]) {
      const n = positive(candidate);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

export function isProblemDetail(arg: unknown): boolean {
  return !!arg && typeof arg === "object" &&
    positive((arg as any).pk) !== undefined && typeof (arg as any).description === "string";
}

export function idsFrom(
  first: unknown,
  rest: unknown[],
  fields: string[]
): (number | undefined)[] {
  if (first && typeof first === "object") {
    const node = first as any;
    const fromArgs: unknown[] = Array.isArray(node.command?.arguments) ? node.command.arguments : [];
    return fields.map((f, i) => positive(node[f]) ?? positive(fromArgs[i]));
  }
  return fields.map((_f, i) => positive(i === 0 ? first : rest[i - 1]));
}

export function extractLessonRef(arg: unknown): { chapter: number; lesson: number } | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const a = arg as any;
  const chapter = typeof a.chapterId === "number" ? a.chapterId : typeof a.chapter === "number" ? a.chapter : undefined;
  const lesson = typeof a.lessonId === "number" ? a.lessonId : typeof a.lesson === "number" ? a.lesson : undefined;
  if (chapter !== undefined && lesson !== undefined) return { chapter, lesson };
  const args = a.command?.arguments;
  if (Array.isArray(args) && typeof args[0] === "number" && typeof args[1] === "number") {
    return { chapter: args[0], lesson: args[1] };
  }
  return undefined;
}

export function extractCourseId(arg: unknown): number | undefined {
  if (typeof arg === "number" && Number.isFinite(arg)) return arg;
  if (arg && typeof arg === "object") {
    const a = arg as any;
    if (typeof a.courseId === "number") return a.courseId;
    if (typeof a.id === "number") return a.id;
    if (typeof a.pk === "number") return a.pk;
  }
  return undefined;
}

export function extractChapterId(arg: unknown): number | undefined {
  if (typeof arg === "number" && Number.isFinite(arg)) return arg;
  if (arg && typeof arg === "object") {
    const a = arg as any;
    if (typeof a.chapterId === "number") return a.chapterId;
    if (typeof a.command?.arguments?.[0] === "number") return a.command.arguments[0];
  }
  return undefined;
}
