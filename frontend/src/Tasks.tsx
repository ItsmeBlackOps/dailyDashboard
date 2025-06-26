interface Props {
  tasks: any[];
}

export default function Tasks({ tasks }: Props) {
  if (tasks.length === 0) {
    return <p className="mt-20 text-center">No tasks found</p>;
  }
  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Today's Tasks</h1>
      <ul className="space-y-2">
        {tasks.map((t, i) => (
          <li key={i} className="rounded border p-2">
            {JSON.stringify(t)}
          </li>
        ))}
      </ul>
    </div>
  );
}
