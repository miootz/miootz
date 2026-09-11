import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Avatar } from "./Avatar";

it("renders the image when a url is provided", () => {
  const { container } = render(
    <Avatar
      url="https://auth.example/api/users/abc/profile-picture.png"
      username="Avery Sample"
    />,
  );
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  expect(img?.getAttribute("src")).toBe(
    "https://auth.example/api/users/abc/profile-picture.png",
  );
});

it("falls back to initials when the image fails to load (Pocket ID 404)", () => {
  const { container } = render(
    <Avatar
      url="https://auth.example/api/users/gone/profile-picture.png"
      username="Avery Sample"
    />,
  );
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  fireEvent.error(img as HTMLImageElement);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("AP")).toBeInTheDocument();
});

it("renders initials directly when there is no url", () => {
  const { container } = render(<Avatar url={null} username="casey example" />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("BI")).toBeInTheDocument();
});
