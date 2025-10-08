import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

describe('TaskModel.filterAndFormatTasks suggestion visibility', () => {
  const model = new TaskModel();

  const baseDoc = {
    _id: 't1',
    subject: 'Interview: Candidate A',
    sender: 'recruiter@example.com',
    'Candidate Name': 'Candidate A',
    'Date of Interview': '09/29/2025',
    'Start Time Of Interview': '10:00 AM',
    'End Time Of Interview': '11:00 AM',
    status: 'pending'
  };

  it('includes unassigned tasks for lead when suggested expert is on their team', () => {
    const docs = [
      { ...baseDoc, _id: 'lead-1', assignedTo: '', candidateExpertRaw: 'expert.one@example.com' }
    ];

    const userEmail = 'lead@example.com';
    const userRole = 'lead';
    const teamEmails = ['lead@example.com', 'expert.one@example.com'];

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, teamEmails);
    expect(tasks.length).toBe(1);
    expect(tasks[0]._id).toBe('lead-1');
  });

  it('includes unassigned tasks for user when suggested expert equals their email', () => {
    const docs = [
      { ...baseDoc, _id: 'user-1', assignedTo: '', candidateExpertRaw: 'expert.self@example.com' }
    ];

    const userEmail = 'expert.self@example.com';
    const userRole = 'user';
    const teamEmails = [userEmail];

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, teamEmails);
    expect(tasks.length).toBe(1);
    expect(tasks[0]._id).toBe('user-1');
  });

  it('includes pending tasks for expert when suggestion matches their display name', () => {
    const docs = [
      { ...baseDoc, _id: 'expert-name-1', assignedTo: 'other@example.com', candidateExpertRaw: 'Aditya Sharma', status: 'Pending' }
    ];

    const userEmail = 'aditya.sharma@example.com';
    const userRole = 'expert';

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, []);
    expect(tasks.length).toBe(1);
    expect(tasks[0]._id).toBe('expert-name-1');
  });

  it('excludes suggestion matches once task status is no longer pending', () => {
    const docs = [
      { ...baseDoc, _id: 'expert-name-2', assignedTo: 'other@example.com', candidateExpertRaw: 'Aditya Sharma', status: 'Completed' }
    ];

    const userEmail = 'aditya.sharma@example.com';
    const userRole = 'expert';

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, []);
    expect(tasks.length).toBe(0);
  });

  it('does not include when no assignment or suggestion match', () => {
    const docs = [
      { ...baseDoc, _id: 'none-1', assignedTo: '', candidateExpertRaw: 'other@example.com' }
    ];

    const userEmail = 'expert.self@example.com';
    const userRole = 'user';
    const teamEmails = [userEmail];

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, teamEmails);
    expect(tasks.length).toBe(0);
  });

  it('does not include suggestion when only last name overlaps', () => {
    const docs = [
      {
        ...baseDoc,
        _id: 'lastname-overlap',
        assignedTo: '',
        candidateExpertRaw: 'Darshan Singh',
        suggestions: ['Darshan Singh']
      }
    ];

    const userEmail = 'astha.singh@example.com';
    const userRole = 'expert';

    const tasks = model.filterAndFormatTasks(docs, userEmail, userRole, []);
    expect(tasks.length).toBe(0);
  });
});
