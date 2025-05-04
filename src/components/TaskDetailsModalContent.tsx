import React from 'react';
import TaskDetails from './TaskDetails';
import { Task } from '../types';

interface TaskDetailsModalContentProps {
  taskToShowDetails: Task | null;
  onDuplicateClick: () => void;
}

const TaskDetailsModalContent: React.FC<TaskDetailsModalContentProps> = ({ taskToShowDetails, onDuplicateClick }) => {
  if (!taskToShowDetails) {
    return <div>Loading task details...</div>;
  }

  return (
    <TaskDetails
      currentTask={taskToShowDetails}
      streamingOutput={''}
      onDuplicateClick={onDuplicateClick}
    />
  );
};

export default TaskDetailsModalContent;
