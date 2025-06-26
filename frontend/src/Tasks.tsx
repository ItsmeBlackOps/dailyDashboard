import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

interface Props {
  tasks: any[];
}

export default function Tasks({ tasks }: Props) {
  if (tasks.length === 0) {
    return <p className="mt-20 text-center">No tasks found</p>;
  }
  return (
    <Card className="mx-auto mt-10 max-w-2xl">
      <CardHeader>
        <CardTitle>Today's Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assigned To</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t, i) => (
              <TableRow key={i}>
                <TableCell>{t.assignedEmail || 'N/A'}</TableCell>
                <TableCell>
                  <pre className="whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(t, null, 2)}
                  </pre>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
