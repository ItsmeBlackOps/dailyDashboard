import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FeedbackFormState = {
  taskStatus: string;
  interviewRound: string;
  feedbackDescription: string;
  interviewQuestions: string;
};

type FeedbackErrors = Partial<Record<keyof FeedbackFormState, string>>;

const initialState: FeedbackFormState = {
  taskStatus: "",
  interviewRound: "",
  feedbackDescription: "",
  interviewQuestions: "",
};

export default function FeedBack() {
  const [formState, setFormState] = useState<FeedbackFormState>(initialState);
  const [errors, setErrors] = useState<FeedbackErrors>({});
  const [lastSubmittedFeedback, setLastSubmittedFeedback] = useState<FeedbackFormState | null>(null);
  const { toast } = useToast();

  const handleChange = (field: keyof FeedbackFormState) => (event: ChangeEvent<HTMLTextAreaElement>) => {
    setFormState((previous) => ({
      ...previous,
      [field]: event.target.value,
    }));
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
  };

  const handleSelectChange = (field: keyof FeedbackFormState) => (value: string) => {
    setFormState((previous) => ({
      ...previous,
      [field]: value,
    }));
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
  };

  const trimmedState = useMemo(
    () => ({
      taskStatus: formState.taskStatus.trim(),
      interviewRound: formState.interviewRound.trim(),
      feedbackDescription: formState.feedbackDescription.trim(),
      interviewQuestions: formState.interviewQuestions.trim(),
    }),
    [formState],
  );

  const validate = () => {
    const nextErrors: FeedbackErrors = {};

    if (!trimmedState.taskStatus) {
      nextErrors.taskStatus = "Task status is required.";
    }

    if (!trimmedState.interviewRound) {
      nextErrors.interviewRound = "Interview round is required.";
    }

    if (trimmedState.feedbackDescription.length < 10) {
      nextErrors.feedbackDescription = "Feedback description should be at least 10 characters long.";
    }

    if (trimmedState.interviewQuestions.length < 5) {
      nextErrors.interviewQuestions = "Share at least one interview question.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    const sanitizedFeedback: FeedbackFormState = {
      taskStatus: DOMPurify.sanitize(trimmedState.taskStatus),
      interviewRound: DOMPurify.sanitize(trimmedState.interviewRound),
      feedbackDescription: DOMPurify.sanitize(trimmedState.feedbackDescription),
      interviewQuestions: DOMPurify.sanitize(trimmedState.interviewQuestions),
    };

    setLastSubmittedFeedback(sanitizedFeedback);
    setFormState(initialState);

    toast({
      title: "Feedback captured",
      description: "Thanks! We will review your feedback shortly.",
    });

    // TODO: Wire up to backend feedback endpoint once available.
  };

  return (
    <DashboardLayout title="Feedback">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Interview Support FeedBack</h1>
          <p className="text-sm text-muted-foreground">
            We read every submission. Let us know what works well and what could be improved.
          </p>
        </section>
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="feedback-task-status">Task Status</Label>
              <Select value={formState.taskStatus} onValueChange={handleSelectChange("taskStatus")}>
                <SelectTrigger
                  id="feedback-task-status"
                  aria-describedby={errors.taskStatus ? "feedback-task-status-error" : undefined}
                  aria-invalid={Boolean(errors.taskStatus)}
                >
                  <SelectValue placeholder="Select task status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                  <SelectItem value="Rescheduled">Rescheduled</SelectItem>
                  <SelectItem value="Not Done">Not Done</SelectItem>
                </SelectContent>
              </Select>
              {errors.taskStatus && (
                <p id="feedback-task-status-error" className="text-sm text-destructive">
                  {errors.taskStatus}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-interview-round">Interview Round</Label>
              <Select value={formState.interviewRound} onValueChange={handleSelectChange("interviewRound")}>
                <SelectTrigger
                  id="feedback-interview-round"
                  aria-describedby={errors.interviewRound ? "feedback-interview-round-error" : undefined}
                  aria-invalid={Boolean(errors.interviewRound)}
                >
                  <SelectValue placeholder="Select interview round" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Screening">Screening</SelectItem>
                  <SelectItem value="On Demand or AI Interview">On Demand or AI Interview</SelectItem>
                  <SelectItem value="1st Round">1st Round</SelectItem>
                  <SelectItem value="2nd Round">2nd Round</SelectItem>
                  <SelectItem value="3rd Round">3rd Round</SelectItem>
                  <SelectItem value="4th Round">4th Round</SelectItem>
                  <SelectItem value="5th Round">5th Round</SelectItem>
                  <SelectItem value="Technical Round">Technical Round</SelectItem>
                  <SelectItem value="Coding Round">Coding Round</SelectItem>
                  <SelectItem value="Final Round">Final Round</SelectItem>
                  <SelectItem value="Loop Round">Loop Round</SelectItem>
                </SelectContent>
              </Select>
              {errors.interviewRound && (
                <p id="feedback-interview-round-error" className="text-sm text-destructive">
                  {errors.interviewRound}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="feedback-description">Feedback Description</Label>
            <Textarea
              id="feedback-description"
              value={formState.feedbackDescription}
              onChange={handleChange("feedbackDescription")}
              placeholder="Enter Brief on the candidate's performance: answer quality, communication, confidence, possibility of moving to next round. If cancelled/not done, state reason – e.g., no show, cancellation, etc."
              rows={6}
              aria-describedby={errors.feedbackDescription ? "feedback-description-error" : undefined}
            />
            {errors.feedbackDescription && (
              <p id="feedback-description-error" className="text-sm text-destructive">
                {errors.feedbackDescription}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="feedback-questions">Interview Asked Questions</Label>
            <Textarea
              id="feedback-questions"
              value={formState.interviewQuestions}
              onChange={handleChange("interviewQuestions")}
              placeholder="Enter List the questions asked in the interview (if AI-generated, ensure review before sharing)."
              rows={6}
              aria-describedby={errors.interviewQuestions ? "feedback-questions-error" : undefined}
            />
            {errors.interviewQuestions && (
              <p id="feedback-questions-error" className="text-sm text-destructive">
                {errors.interviewQuestions}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="lg">
              Submit Feedback
            </Button>
          </div>
        </form>
        {lastSubmittedFeedback && (
          <Alert>
            <AlertTitle>Submission received</AlertTitle>
            <AlertDescription className="space-y-2 text-sm">
              <p>
                Task Status: <strong>{lastSubmittedFeedback.taskStatus}</strong>
              </p>
              <p>
                Interview Round: <strong>{lastSubmittedFeedback.interviewRound}</strong>
              </p>
              <div>
                <p className="font-medium">Feedback Description:</p>
                <p className="whitespace-pre-line">{lastSubmittedFeedback.feedbackDescription}</p>
              </div>
              <div>
                <p className="font-medium">Interview Asked Questions:</p>
                <p className="whitespace-pre-line">{lastSubmittedFeedback.interviewQuestions}</p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </DashboardLayout>
  );
}
