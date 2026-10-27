import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Keyboard } from "@phosphor-icons/react/dist/csr/Keyboard";
import { Question } from "@phosphor-icons/react/dist/csr/Question";
import { Button, EmptyBlock, PageHeader } from "@anvi/ui";
import { helpCopy as text } from "../lib/copy/insights";
import "./help.css";

// Static answers for everyday tasks, searchable and grouped by topic.
export default function Help() {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const topics = useMemo(
    () =>
      text.topics
        .map((topic) => ({
          ...topic,
          articles: topic.articles.filter(
            (article) =>
              !term ||
              `${article.q} ${article.a} ${topic.title}`
                .toLowerCase()
                .includes(term),
          ),
        }))
        .filter((topic) => topic.articles.length),
    [term],
  );
  const count = topics.reduce((sum, topic) => sum + topic.articles.length, 0);
  return (
    <div className="page-enter help">
      <PageHeader title={text.title} description={text.description} />
      <div className="help-search">
        <label className="search-box">
          <MagnifyingGlass size={19} />
          <input
            type="search"
            aria-label={text.search}
            placeholder={text.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="sr-only" role="status" aria-live="polite">
          {term ? text.results(count) : ""}
        </span>
      </div>
      <div className="help-layout">
        <div className="help-topics">
          {count === 0 ? (
            <section className="panel">
              <EmptyBlock
                icon={Question}
                title={text.noResults.title}
                description={text.noResults.description}
                action={
                  <Button variant="secondary" onPress={() => setQuery("")}>
                    {text.noResults.clear}
                  </Button>
                }
              />
            </section>
          ) : (
            topics.map((topic) => (
              <section
                className="panel help-topic"
                key={topic.id}
                aria-labelledby={`topic-${topic.id}`}
              >
                <h2 id={`topic-${topic.id}`}>{topic.title}</h2>
                {topic.articles.map((article) => (
                  <details key={article.q} open={Boolean(term)}>
                    <summary>
                      <span>{article.q}</span>
                      <CaretDown size={16} aria-hidden="true" />
                    </summary>
                    <p>{article.a}</p>
                  </details>
                ))}
              </section>
            ))
          )}
        </div>
        <aside className="panel help-shortcuts" aria-labelledby="shortcuts">
          <h2 id="shortcuts">
            <Keyboard size={19} aria-hidden="true" /> {text.shortcuts.title}
          </h2>
          <dl>
            {text.shortcuts.items.map((item) => (
              <div key={item.keys}>
                <dt>
                  <kbd>{item.keys}</kbd>
                </dt>
                <dd>{item.does}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
