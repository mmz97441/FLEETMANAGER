import React from 'react';
import { Mission, User } from '../types';
import ClaimScanModal from './ClaimScanModal';

/** Receiving a physical parcel follows the same audited scan rule as every driver entry point. */
const TransferReceiveModal: React.FC<{
  currentUser: User; toMission: Mission; onClose: () => void; onDone: (count: number, missionId?: string) => void;
}> = ({ currentUser, toMission, onClose, onDone }) => (
  <ClaimScanModal currentUser={currentUser} targetMissionId={toMission.id} source="transfer"
    confirmLabel="Ouvrir ma tournée" onClose={onClose} onDone={onDone} />
);
export default TransferReceiveModal;
