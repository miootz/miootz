import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import type { GoalRow } from "../api/stewardApi";
import { GoalList } from "./GoalList";

const person = (name: string) => ({ id: 1, display_name: name, avatar_url: null });

const goal = (team: "a" | "b"): GoalRow => ({
  id: 1,
  team,
  clock_minute: 11,
  scorer: person(team === "a" ? "Demo Player 03" : "Xavi"),
  assist: null,
  goalkeeper: null,
  recorded_by: person("Admin"),
});

const rowOf = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(name),
  ) as HTMLLIElement;

it("renders a ball before the minute for home goals and after for away", () => {
  const { container } = render(
    <GoalList goals={[goal("a"), goal("b")]} canEdit={false} onEdit={() => {}} />,
  );
  const home = rowOf(container, "Demo Player 03");
  const away = rowOf(container, "Xavi");
  const homeRow = home.querySelector("span.flex") as HTMLElement;
  const awayRow = away.querySelector("span.flex") as HTMLElement;
  // Home: ball, minute, name. Away: name, minute, ball.
  expect(homeRow.firstElementChild?.tagName).toBe("svg");
  expect(homeRow.children[1]?.textContent).toBe("11\u2032");
  expect(awayRow.lastElementChild?.tagName).toBe("svg");
  expect(awayRow.children[awayRow.children.length - 2]?.textContent).toBe(
    "11\u2032",
  );
});
