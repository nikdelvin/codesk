import { Fragment } from "react";

interface Props {
  text: string;
  font?: "normal" | "semibold" | "extrabold";
  sm?: boolean;
}

export default function Grad({ text, font, sm }: Props) {
  return (
    <>
      {text.split("<g>").map((word, index) => (
        <Fragment key={index}>
          {word.includes("</g>") ? (
            <>
              <span
                className={`inline opacity-95 ${sm ? "text-shadow-[0.5px_0.5px_0px_red,-0.5px_-0.5px_0px_cyan]/75" : "text-shadow-[1px_1px_0px_red,-1px_-1px_0px_cyan]/75"} ${font === "extrabold" ? "font-extrabold" : font === "semibold" ? "font-semibold" : font === "normal" ? "font-normal" : ""}`}
              >
                {word.split("</g>")[0]}
              </span>
              {word.split("</g>")[1]}
            </>
          ) : (
            <span className="opacity-90">{word}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}
