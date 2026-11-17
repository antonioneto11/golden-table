import { DIMS, dimLabel, GROUP_INFO } from "../../shared/dims";
import { groupEffect, shareGroupsFor, usedDimKeys } from "../../shared/scoring";
import { GROUP_FEED, GROUPS, type Feeds, type Group } from "../../shared/types";
import { useCurrent, useJobUpdate, useStore } from "../store";
import { Card, SelectField, TextField } from "../ui";

export function GuideTab() {
  const { setUi } = useStore();
  const { job } = useCurrent();
  const edit = useJobUpdate();
  if (!job) return null;
  const used = usedDimKeys(job);
  const name = (k: (typeof used)[number]) => dimLabel(k, job.dims[k].plainName);

  const options = (g: Group): { value: string; label: string }[] => {
    const cur = job.feeds[GROUP_FEED[g]] as string;
    const opts: { value: string; label: string }[] = GROUP_INFO[g].rule
      ? [
          { value: "", label: "Has no effect" },
          { value: "auto", label: "Fails the answer automatically" },
          ...used.map((k) => ({ value: k, label: `Sets ${name(k)} to 0` })),
        ]
      : [{ value: "", label: "Nothing (not scored)" }, ...used.map((k) => ({ value: k, label: `Scores ${name(k)} (share met)` }))];
    if (g === "U") opts.push(...used.map((k) => ({ value: `share:${k}`, label: `Scores ${name(k)} (share followed)` })));
    if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: `${cur} (dimension not in use, so no effect)` });
    return opts;
  };
  const setFeed = (g: Group, v: string) => edit((j) => void ((j.feeds as unknown as Record<keyof Feeds, string>)[GROUP_FEED[g]] = v));

  const labels: Record<Group, string> = {
    S: '"Must say" checks score',
    W: '"Must show" checks score',
    N: 'Breaking a "Must not do" rule (answer did it)',
    U: 'Not following the "If unsure" rule',
    A: 'Going outside the "Allowed ways" (code check)',
  };
  const stale = GROUPS.filter((g) => job.feeds[GROUP_FEED[g]] && groupEffect(job, g).kind === "none");
  const off = DIMS.filter((d) => d.neverScored || !job.dims[d.key].used);

  return (
    <>
      <Card>
        <h2>4. Decide how each dimension gets its score</h2>
        <p className="muted small">
          Yes/no checks are more repeatable than picking a number. Point each check group at the dimension it proves, and that dimension is scored as the share of
          checks met. A broken rule can fail the answer outright or set one dimension to 0.
        </p>
        {GROUPS.map((g) => (
          <SelectField key={g} label={labels[g]} value={job.feeds[GROUP_FEED[g]] as string} options={options(g)} onChange={(v) => setFeed(g, v)} />
        ))}
        {stale.length > 0 && (
          <p className="note err">
            {stale.map((g) => GROUP_INFO[g].title).join(", ")} point{stale.length === 1 ? "s" : ""} at a dimension that is not in use, so {stale.length === 1 ? "it has" : "they have"}{" "}
            no effect.
          </p>
        )}
      </Card>

      {!used.length && (
        <Card>
          <p>Pick dimensions first.</p>
        </Card>
      )}
      {used.map((k) => {
        const x = job.dims[k];
        const fed = shareGroupsFor(job, k);
        const zeroBy = GROUPS.filter((g) => {
          const e = groupEffect(job, g);
          return e.kind === "zero" && e.dim === k;
        });
        const scale = (
          <>
            <TextField label="0 means" value={x.s0} onChange={(v) => edit((j) => void (j.dims[k].s0 = v))} />
            <TextField label="3 means" value={x.s3} onChange={(v) => edit((j) => void (j.dims[k].s3 = v))} />
            <TextField label="5 means" value={x.s5} onChange={(v) => edit((j) => void (j.dims[k].s5 = v))} />
          </>
        );
        return (
          <Card key={k}>
            <div className="row wrap">
              <h3 className="grow">{name(k)}</h3>
              <span className="pill plain">Weight {x.weight}</span>
            </div>
            {fed.length ? (
              <>
                <p className="note">
                  Scored from checks: the share of {fed.map((g) => `"${GROUP_INFO[g].title}"`).join(" and ")} lines met. No number to pick.
                </p>
                <details>
                  <summary>0/3/5 guide for rows that have no lines in that group (then it is scored by hand)</summary>
                  <div className="sub" style={{ marginTop: 8 }}>
                    {scale}
                  </div>
                </details>
              </>
            ) : (
              <>
                <p className="muted small">Scored by hand on 0, 3 or 5 only. Describe each point so two graders land on the same number.</p>
                {scale}
              </>
            )}
            {zeroBy.length > 0 && <p className="note">Drops to 0 if the answer breaks {zeroBy.map((g) => `"${GROUP_INFO[g].title}"`).join(" or ")}.</p>}
          </Card>
        );
      })}

      <Card className="off">
        <h3>Not used in this rubric</h3>
        <div className="tablewrap">
          <table>
            <tbody>
              {off.map((d) => (
                <tr key={d.key}>
                  <td>{d.name}</td>
                  <td className="muted">{d.neverScored ? "Reported separately, never scored" : job.dims[d.key].whyNotUsed || "No reason written yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button className="btn" onClick={() => setUi({ tab: 1 })}>
            Change dimensions
          </button>
        </div>
      </Card>
    </>
  );
}
