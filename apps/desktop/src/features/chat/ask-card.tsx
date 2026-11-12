"use client";

// ask_user 的提问卡片（primus-plan 推来的 primus:ask）：显示在输入框上方，一次一题。
// 每题：选一个选项，或在最后一行直接写自己的想法；答完最后一题一起发回扩展。关闭表示不回答（模型停下）。
import type { AskAnswer, AskData } from "@primus/protocol";
import { useState } from "react";
import { strings } from "@/lib/strings";
import { ChoiceCard } from "./choice-card";

const t = strings.chat.ask;

/** 推荐项：模型按约定在标签末尾写“（推荐）”/“(Recommended)”，卡片上去掉后缀改成小标记 */
const RECOMMENDED = /\s*[（(](推荐|recommended)[）)]\s*$/i;

export function AskCard({
  ask,
  onAnswer,
  onCancel,
}: {
  ask: AskData;
  onAnswer: (answers: Record<string, AskAnswer>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AskAnswer>>({});
  const q = ask.questions[index];
  if (!q) return null;
  const total = ask.questions.length;
  const next = (a: AskAnswer) => {
    const all = { ...answers, [q.id]: a };
    if (index + 1 >= total) onAnswer(all);
    else {
      setAnswers(all);
      setIndex(index + 1);
    }
  };
  return (
    <ChoiceCard
      // 换题时重置输入框
      key={q.id}
      label={t.label}
      icon="ask"
      header={q.header}
      progress={total > 1 ? `${index + 1}/${total}` : undefined}
      title={q.question}
      options={q.options.map((o) => ({
        key: o.label,
        label: o.label.replace(RECOMMENDED, ""),
        description: o.description,
        recommended: RECOMMENDED.test(o.label),
      }))}
      recommendedLabel={t.recommended}
      otherLabel={t.otherLabel}
      otherPlaceholder={t.otherPlaceholder}
      sendLabel={t.send}
      dismissLabel={t.dismiss}
      onChoose={(label) => next({ selected: label })}
      onOther={(text) => next({ other: text })}
      onDismiss={onCancel}
    />
  );
}
